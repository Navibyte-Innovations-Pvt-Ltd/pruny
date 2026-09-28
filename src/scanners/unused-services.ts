import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Config, UnusedServiceMethod } from '../types.js';
import { findServiceProperties } from '../fixer.js';
import { JS_KEYWORDS, NEST_LIFECYCLE_METHODS, FRAMEWORK_METHOD_DECORATORS, DEFAULT_IGNORE } from '../constants.js';
import { sanitizeLine, readSourceFile } from '../utils.js';

/**
 * Scan all service files (*.service.ts) in the project and find unused methods.
 * A method is considered unused if it's not called by any controller, other service, or module.
 */
export async function scanUnusedServices(config: Config): Promise<{ total: number; methods: UnusedServiceMethod[] }> {
  const projectRoot = config.dir;
  const methods: UnusedServiceMethod[] = [];

  // 1. Find all service files
  const candidateCwd = config.appSpecificScan ? config.appSpecificScan.appDir : projectRoot;
  const serviceFiles = fg.sync('**/*.service.{ts,tsx}', {
    cwd: candidateCwd,
    ignore: DEFAULT_IGNORE,
    absolute: true
  });

  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG scanUnusedServices] Found ${serviceFiles.length} service files in ${candidateCwd}`);
  }

  // 2. Find all TypeScript files in the WHOLE project to check for usage
  const referenceCwd = config.appSpecificScan ? config.appSpecificScan.rootDir : projectRoot;
  const allFiles = fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: referenceCwd,
    ignore: DEFAULT_IGNORE,
    absolute: true
  });

  // Each reference file is read at most once for the whole scan
  const contentCache = new Map<string, string | null>();
  const readCached = (file: string): string | null => {
    let content = contentCache.get(file);
    if (content === undefined) {
      try {
        content = readSourceFile(file);
      } catch {
        content = null;
      }
      contentCache.set(file, content);
    }
    return content;
  };

  for (const serviceFile of serviceFiles) {
    try {
      const content = readFileSync(serviceFile, 'utf-8');

      // Get the service class name
      const classMatch = content.match(/export\s+class\s+(\w+)/);
      if (!classMatch) continue;
      const serviceClassName = classMatch[1];

      // Files that import this service class, with the property names they bind it to.
      // Computed once per service (lazily) instead of once per method × file.
      let importers: { file: string; fileContent: string; serviceProps: string[] }[] | undefined;
      const getImporters = () => {
        if (importers) return importers;
        importers = [];
        const importRegex = new RegExp(`import.*\\b${serviceClassName}\\b.*from`);
        for (const file of allFiles) {
          if (file === serviceFile) continue;
          const fileContent = readCached(file);
          if (fileContent === null || !importRegex.test(fileContent)) continue;
          try {
            importers.push({ file, fileContent, serviceProps: findServiceProperties(fileContent, serviceClassName) });
          } catch {
            // Skip files we cannot analyze
          }
        }
        return importers;
      };

      // Find all methods in the service class using brace-depth tracking.
      // Only detect methods at class body level (braceDepth 1) to avoid
      // matching control flow keywords (if, for, catch, switch) inside method bodies.
      const contentLines = content.split('\n');
      let braceDepth = 0;
      let inClass = false;
      let inMultilineComment = false;

      // Combined skip set: JS keywords + lifecycle hooks
      const SKIP_NAMES = new Set([...JS_KEYWORDS, ...NEST_LIFECYCLE_METHODS, 'default', 'from']);

      for (let lineIdx = 0; lineIdx < contentLines.length; lineIdx++) {
        const line = contentLines[lineIdx];
        const trimmed = line.trim();

        // Track multiline comments
        if (inMultilineComment) {
          if (trimmed.includes('*/')) inMultilineComment = false;
          continue;
        }
        if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
          inMultilineComment = true;
          continue;
        }

        // Skip single-line comments and empty lines (but still count braces)
        if (trimmed.startsWith('//') || trimmed === '') {
          const cleanLine = sanitizeLine(line);
          braceDepth += (cleanLine.match(/{/g) || []).length - (cleanLine.match(/}/g) || []).length;
          continue;
        }

        // Track class declaration
        if (/export\s+class\s+\w+/.test(line)) {
          inClass = true;
        }

        // Clean line for brace counting
        const cleanLine = sanitizeLine(line);
        const opens = (cleanLine.match(/{/g) || []).length;
        const closes = (cleanLine.match(/}/g) || []).length;

        // Only detect methods at class body level (braceDepth === 1)
        if (inClass && braceDepth === 1 && !trimmed.startsWith('@')) {
          const methodMatch = trimmed.match(/^(?:(?:public|private|protected|static|readonly|async|override)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(/);
          if (methodMatch) {
            const methodName = methodMatch[1];
            const fullMatch = methodMatch[0];

            // Skip keywords, lifecycle hooks, private methods
            if (!SKIP_NAMES.has(methodName) && !fullMatch.includes('private ')) {
              // Check preceding lines for framework decorators (e.g., @Cron, @OnEvent)
              // Decorators can span multiple lines: @Cron('...', { ... })
              let isFrameworkManaged = false;
              for (let k = 1; k <= 20; k++) {
                const prevIdx = lineIdx - k;
                if (prevIdx < 0) break;
                const prevLine = contentLines[prevIdx].trim();
                if (prevLine === '' || prevLine.startsWith('//') || prevLine.startsWith('*')) continue;
                if (prevLine.startsWith('@')) {
                  if (Array.from(FRAMEWORK_METHOD_DECORATORS).some(d => prevLine.startsWith(d))) {
                    isFrameworkManaged = true;
                  }
                  break;
                }
                // Stop at method body end (previous method's closing brace at class level)
                // But don't stop at }) or }); which could be decorator argument closing
                if (prevLine === '}' && braceDepth === 1) break;
              }
              if (isFrameworkManaged) {
                braceDepth += opens - closes;
                continue;
              }

              const methodLine = lineIdx + 1; // 1-indexed

              if (process.env.DEBUG_PRUNY) {
                console.log(`[DEBUG scanUnusedServices] Found method ${methodName} at line ${methodLine} (braceDepth=${braceDepth})`);
              }

              // Check if this method is used internally (this.methodName)
              const internalMatches = content.match(new RegExp(`this\\.${methodName}\\s*\\(`, 'g'));
              if (internalMatches && internalMatches.length > 0) {
                // Found internal this.method() call — method is used within the class
                braceDepth += opens - closes;
                continue;
              }

              // Check if this method is used anywhere else
              const usedBy: UnusedServiceMethod['usedBy'] = [];

              for (const { file, fileContent, serviceProps } of getImporters()) {
                let usageFound = false;
                for (const propName of serviceProps) {
                  const methodCallRegex = new RegExp(`this\\.${propName}\\.${methodName}\\s*\\(`);
                  if (methodCallRegex.test(fileContent)) {
                    usageFound = true;
                    break;
                  }
                  const optionalChainRegex = new RegExp(`this\\.${propName}\\?\\.${methodName}\\s*\\(`);
                  if (optionalChainRegex.test(fileContent)) {
                    usageFound = true;
                    break;
                  }
                }

                if (!usageFound) {
                  const directCallRegex = new RegExp(`\\.${methodName}\\s*\\(`);
                  if (directCallRegex.test(fileContent)) {
                    if (fileContent.includes(serviceClassName)) {
                      usageFound = true;
                    }
                  }
                }

                if (usageFound) {
                  let usageType: 'controller' | 'service' | 'module' = 'service';
                  if (file.includes('.controller.')) usageType = 'controller';
                  else if (file.includes('.module.')) usageType = 'module';

                  usedBy.push({ file: relative(projectRoot, file), type: usageType });
                  break;
                }
              }

              if (usedBy.length === 0) {
                methods.push({
                  name: methodName,
                  file: relative(projectRoot, serviceFile),
                  line: methodLine,
                  serviceClassName,
                  usedBy: []
                });
              }
            }
          }
        }

        // Update brace depth AFTER checking current line
        braceDepth += opens - closes;
      }
    } catch (err) {
      console.error(`Error scanning service ${serviceFile}:`, err);
    }
  }

  return { total: methods.length, methods };
}
