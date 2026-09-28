import fg from 'fast-glob';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, parse, isAbsolute } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { Config, UnusedExport, ApiRoute } from '../types.js';
import {
  IGNORED_EXPORT_NAMES, FRAMEWORK_METHOD_DECORATORS, NEST_LIFECYCLE_METHODS,
  JS_KEYWORDS, CLASS_METHOD_REGEX, INLINE_EXPORT_REGEX, BLOCK_EXPORT_REGEX,
  GENERIC_METHOD_NAMES, DEFAULT_IGNORE, isServiceLikeFile,
} from '../constants.js';
import { sanitizeLine, escapeRegExp, makeCodePattern, readSourceFile, isFileCacheActive } from '../utils.js';

/**
 * Process files in parallel using worker threads
 */
/**
 * Helper to find the nearest project root (package.json)
 */
function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  while (currentDir !== parse(currentDir).root) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return startDir; // Fallback to startDir if no package.json found
}

async function processFilesInParallel(
  files: string[],
  cwd: string,
  workerCount: number
): Promise<{
  exportMap: Map<string, { name: string; line: number; file: string }[]>;
  contents: Map<string, string>;
}> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Worker is compiled to dist/workers/file-processor.js
  // When running via bun/ts-node, we might need a different path
  let workerPath = join(__dirname, 'workers/file-processor.js');
  if (!existsSync(workerPath)) {
    // Try relative to project root (works for bun src/scanners/...)
    const root = join(__dirname, '../../');
    const possiblePaths = [
      join(root, 'dist/workers/file-processor.js'),
      join(root, 'src/workers/file-processor.ts'),
      join(__dirname, '../workers/file-processor.ts')
    ];
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        workerPath = p;
        break;
      }
    }
  }
  
  // Split files into chunks for each worker
  const chunkSize = Math.ceil(files.length / workerCount);
  const chunks: string[][] = [];
  for (let i = 0; i < workerCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, files.length);
    if (start < files.length) {
      chunks.push(files.slice(start, end));
    }
  }
  
  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const contents = new Map<string, string>();
  const progressMap = new Map<number, { processed: number; total: number }>();
  
  // Create workers
  const workerPromises = chunks.map((chunk, chunkId) => {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          files: chunk,
          cwd,
          chunkId
        }
      });
      
      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          // Update progress for this worker
          progressMap.set(msg.chunkId, {
            processed: msg.processed,
            total: msg.total
          });
          
          // Calculate total progress
          let totalProcessed = 0;
          let totalFiles = 0;
          for (const [, progress] of progressMap.entries()) {
            totalProcessed += progress.processed;
            totalFiles += progress.total;
          }
          
          const percent = Math.round((totalProcessed / totalFiles) * 100);
          process.stdout.write(`\r      Processing: ${totalProcessed}/${totalFiles} (${percent}%)${' '.repeat(10)}`);
        } else if (msg.type === 'complete') {
          // Merge results
          const result = msg.result;
          
          // Convert plain objects back to Maps
          const workerExportMap = new Map(Object.entries(result.exports));
          const workerContents = new Map(Object.entries(result.contents));
          
          for (const [file, exports] of workerExportMap.entries()) {
            exportMap.set(file, exports as { name: string; line: number; file: string }[]);
          }
          
          for (const [file, content] of workerContents.entries()) {
            contents.set(file, content as string);
          }
          
          worker.terminate();
          resolve();
        }
      });
      
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  });
  
  await Promise.all(workerPromises);
  
  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  
  return { exportMap, contents };
}

/**
 * Scan for unused named exports within source files
 */
export async function scanUnusedExports(config: Config, routes: ApiRoute[] = [], options: { silent?: boolean } = {}): Promise<{ total: number; used: number; unused: number; exports: UnusedExport[] }> {
  const cwd = config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  // 1. Determine Scope
  // Candidates: Files we want to find unused exports IN (e.g., apps/web)
  const candidateCwd = config.appSpecificScan ? config.appSpecificScan.appDir : cwd;
  
  // References: Files we want to check for USAGE in
  // Per user request: Only check usage within the App itself (Local), not Global.
  // CRITICAL FIX: If user runs on a subdir (e.g. src/utils/billing), we MUST scan the whole PROJECT for usage.
  // Otherwise we delete files used elsewhere in the same app.
  const referenceCwd = config.appSpecificScan 
    ? config.appSpecificScan.rootDir 
    : findProjectRoot(cwd);

  if (!options.silent) {
    process.stdout.write(`   🔗 Scanning exports...`);
  }

  // 2. Find Candidate Files (to scan for exports)
  let candidateFiles = await fg(extGlob, {
    cwd: candidateCwd,
    ignore: [...DEFAULT_IGNORE, ...config.ignore.folders, ...config.ignore.files],
    absolute: true // Get absolute paths to match easily
  });

  if (config.folder) {
    const folderFilter = config.folder.replace(/\\/g, '/');
    candidateFiles = candidateFiles.filter(f => f.replace(/\\/g, '/').includes(folderFilter));
  }

  if (candidateFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, exports: [] };
  }

  // 3. Find Reference Files (to check for usage).
  // Note: `config.ignore.files` is intentionally NOT applied here. Those files are
  // excluded from candidates (we don't report their exports) but they must remain
  // in the reference set — otherwise an export that is used only from an ignored
  // UI wrapper / server action gets falsely flagged. See issue #38.
  const referenceFiles = await fg(extGlob, {
    cwd: referenceCwd,
    ignore: [...DEFAULT_IGNORE, ...config.ignore.folders],
    absolute: true
  });


  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG] Found ${candidateFiles.length} candidate files`);
    console.log(`[DEBUG] Found ${referenceFiles.length} reference files`);
    if (candidateFiles.length > 0) {
      console.log(`[DEBUG] First candidate: ${candidateFiles[0]}`);
    }
  }

  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const totalContents = new Map<string, string>();
  let allExportsCount = 0;

  // Patterns to find exports (fresh instances since RegExp with /g is stateful)
  const inlineExportRegex = new RegExp(INLINE_EXPORT_REGEX.source, INLINE_EXPORT_REGEX.flags);
  const blockExportRegex = new RegExp(BLOCK_EXPORT_REGEX.source, BLOCK_EXPORT_REGEX.flags);

  // Use parallel processing for large projects (500+ files). Skipped when the shared
  // file cache is active: earlier scanners already read every file on this thread, so
  // workers would only re-read them and clone the contents back.
  const USE_WORKERS = referenceFiles.length >= 500 && !isFileCacheActive();
  const WORKER_COUNT = 2; // Gentle on CPU - only 2 workers

  if (USE_WORKERS) {
    if (!options.silent) process.stdout.write(` ${candidateFiles.length} candidates, ${referenceFiles.length} refs\n`);
    
    // Process ALL reference files (superset) so we have contents for usage check
    // We only care about exports from candidateFiles, but we need contents of everything.
    const result = await processFilesInParallel(referenceFiles, referenceCwd, WORKER_COUNT);
    
    // Merge file contents (Global)
    for (const [file, content] of result.contents.entries()) {
      totalContents.set(file, content);
    }

    // Merge results from workers, BUT only keep exports if they are in candidateFiles
    const candidateSet = new Set(candidateFiles);
    
    for (const [file, exports] of result.exportMap.entries()) {
      // Worker returns absolute paths or relatives? processFilesInParallel uses cwd
      // Let's ensure we are matching correctly.
      // If processFilesInParallel passed absolute paths, it returns absolute keys.
      
      const absoluteFile = file.startsWith('/') ? file : join(referenceCwd, file);
      
      if (candidateSet.has(absoluteFile)) {
         // Fix relative path for display/reporting relative to project root (or app root?)
         // The types expect relative paths usually.
         const displayPath = relative(config.dir, absoluteFile); // Relative to execution root
         
         const mappedExports = exports.map(e => ({...e, file: displayPath}));
         exportMap.set(displayPath, mappedExports);
         allExportsCount += mappedExports.length;
      }
    }
    
  } else {
  if (!options.silent) process.stdout.write(` ${candidateFiles.length} candidates, ${referenceFiles.length} refs\n`);
  
  // We need to read ALL reference files to build totalContents
  for (const file of referenceFiles) {
      try {
          const content = readSourceFile(file);
          totalContents.set(file, content);
      } catch (_e) {
        // Skip
      }
  }

  let processedFiles = 0;
  
  // Only scan candidates for EXPORTS
  for (const file of candidateFiles) {
    try {
      processedFiles++;
      
      // Relative path for reporting
      const displayPath = relative(config.dir, file); 

      // Show progress every 10 files
      if (!options.silent && (processedFiles % 10 === 0 || processedFiles === candidateFiles.length)) {
        const percent = Math.round((processedFiles / candidateFiles.length) * 100);
        process.stdout.write(`\r      Processing: ${processedFiles}/${candidateFiles.length} (${percent}%)${' '.repeat(10)}`);
      }
      
      const content = totalContents.get(file) || readFileSync(file, 'utf-8');
      totalContents.set(file, content);

      const isService = isServiceLikeFile(file);
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 1. Regular exports
        inlineExportRegex.lastIndex = 0;
        let match;
        while ((match = inlineExportRegex.exec(line)) !== null) {
          if (addExport(displayPath, match[1], i + 1)) {
            allExportsCount++;
          }
        }

        blockExportRegex.lastIndex = 0;
        while ((match = blockExportRegex.exec(line)) !== null) {
          const names = match[1].split(',').map((n: string) => {
             const parts = n.trim().split(/\s+as\s+/);
             return parts[parts.length - 1];
          });
          for (const name of names) {
            if (addExport(displayPath, name, i + 1)) {
              allExportsCount++;
            }
          }
        }

      } // End of line-by-line loop

      // 2. Class methods in services (Cascading fix)
      if (isService) {
        const classMethodRegex = new RegExp(CLASS_METHOD_REGEX.source, CLASS_METHOD_REGEX.flags);
        let match;
        while ((match = classMethodRegex.exec(content)) !== null) {
          const name = match[1];
          if (name && !NEST_LIFECYCLE_METHODS.has(name) && !IGNORED_EXPORT_NAMES.has(name) && !JS_KEYWORDS.has(name)) {
            // Calculate line number from the NAME index, not the match start (to avoid including preceding newlines)
            const nameIndex = match.index + match[0].indexOf(name);
            const lineNum = content.substring(0, nameIndex).split('\n').length;

            if (process.env.DEBUG_PRUNY) {
              console.log(`[DEBUG] Found candidate method: ${name} in ${displayPath} at line ${lineNum}`);
            }

            // Framework awareness: Check for decorators that imply framework usage
            let isFrameworkManaged = false;
            for (let k = 1; k <= 15; k++) {
              if (lineNum - 1 - k >= 0) {
                const prevLine = lines[lineNum - 1 - k].trim();
                if (prevLine.startsWith('@') && Array.from(FRAMEWORK_METHOD_DECORATORS).some(d => prevLine.startsWith(d))) {
                  isFrameworkManaged = true;
                  if (process.env.DEBUG_PRUNY) {
                    console.log(`[DEBUG] Method ${name} is framework managed by ${prevLine}`);
                  }
                  break;
                }
                if (prevLine.startsWith('export class') || prevLine.includes(' constructor(') || (prevLine.includes(') {') && !prevLine.startsWith('@') && !prevLine.endsWith(')'))) {
                  break;
                }
              }
            }

            if (isFrameworkManaged) continue;

            const existing = exportMap.get(displayPath)?.find(e => e.name === name);
            if (!existing) {
              if (addExport(displayPath, name, lineNum)) {
                allExportsCount++;
                if (process.env.DEBUG_PRUNY) {
                  console.log(`[DEBUG] Added unused candidate: ${name}`);
                }
              }
            }
          }
        }
      }
    } catch (_err) {
      // Skip unreadable
    }
  }
  
  // Clear progress line
  if (!options.silent && processedFiles > 0) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }
  } // Close else block


  function addExport(file: string, name: string, line: number): boolean {
    if (name && !IGNORED_EXPORT_NAMES.has(name)) {
      if (!exportMap.has(file)) exportMap.set(file, []);
      exportMap.get(file)!.push({ name, line, file });
      return true;
    }
    return false;
  }

  const unusedExports: UnusedExport[] = [];

  // 1.5. Calculate ignore ranges for cascading deletion (ignore references that come from unused code)
  const ignoreRanges = new Map<string, { start: number; end: number }[]>();
  if (routes.length > 0) {
    for (const route of routes) {
      if (route.used && route.unusedMethods.length === 0) continue;
      
      const rootDir = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
      const absoluteFilePath = isAbsolute(route.filePath) ? route.filePath : join(rootDir, route.filePath);
      
      if (!ignoreRanges.has(absoluteFilePath)) ignoreRanges.set(absoluteFilePath, []);
      
      // If route is fully unused, ignore the entire file (including imports/constructor)
      if (!route.used) {
         ignoreRanges.get(absoluteFilePath)!.push({ start: 1, end: Number.MAX_SAFE_INTEGER });
         continue;
      }
      
      // Convert absolute path to path relative to scanCwd (which equates to totalContents keys)
      const scanCwd = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
      const relativeToScanCwd = relative(scanCwd, absoluteFilePath);
      
      const content = totalContents.get(relativeToScanCwd);
      if (!content) continue;
      
      const lines = content.split('\n');
      for (const method of route.unusedMethods) {
        const lineNum = route.methodLines[method];
        if (!lineNum) continue;
        
        const endLine = findMethodEnd(lines, lineNum - 1);
        ignoreRanges.get(absoluteFilePath)!.push({ start: lineNum, end: endLine + 1 });
      }
    }
  }
  
  if (!options.silent) process.stdout.write(`      Checking ${allExportsCount} exports for usage...`);

  // 3. Check for references in all files
  //
  // Per-file work (string stripping, line splitting, app detection) is computed
  // once per file instead of once per export × file pair, and an inverted index
  // (identifier token -> files containing it) limits each export's search to the
  // files that could possibly reference it. Every usage check below requires the
  // export name to appear as a whole `\w+` run in the raw content, so skipping
  // files without that token cannot change the result.
  const refFiles = buildReferenceIndex(totalContents, config.dir);
  const refFileByPath = new Map(refFiles.files.map(f => [f.path, f]));

  for (const [file, exports] of exportMap.entries()) {
    for (const exp of exports) {
      let isUsed = false;
      let usedInternally = false;

      const escapedName = escapeRegExp(exp.name);
      const referenceRegex = new RegExp(`\\b${escapedName}\\b`);
      const codePattern = makeCodePattern(exp.name);
      const isGeneric = GENERIC_METHOD_NAMES.has(exp.name);

      // First check internal usage (within the same file)
      const absoluteFile = join(config.dir, file);
      const ownFile = refFileByPath.get(absoluteFile);

      if (ownFile) {
        const lines = getLines(ownFile);
        const fileIgnoreRanges = ignoreRanges.get(absoluteFile);
        let fileInMultilineComment = false;
        let fileInTemplateLiteral = false;

        for (let i = 0; i < lines.length; i++) {
          if (i === exp.line - 1) continue; // Skip the declaration line

          if (fileIgnoreRanges?.some(r => (i + 1) >= r.start && (i + 1) <= r.end)) {
            continue;
          }

          const line = lines[i];
          const trimmed = line.trim();

          // Track multi-line comment state
          if (trimmed.includes('/*')) fileInMultilineComment = true;
          if (trimmed.includes('*/')) {
            fileInMultilineComment = false;
            continue;
          }
          if (fileInMultilineComment) continue;

          // Track template literal state
          const backtickCount = (line.match(/`/g) || []).length;
          if (backtickCount % 2 !== 0) {
            fileInTemplateLiteral = !fileInTemplateLiteral;
          }
          if (fileInTemplateLiteral) continue;

          // Skip single-line comments
          if (trimmed.startsWith('//')) continue;

          // Skip text inside single or double quotes or backticks (robustly)
          const lineWithoutStrings = line
            .replace(/'[^']*'/g, "''")
            .replace(/"[^"]*"/g, '""')
            .replace(/`[^`]*`/g, "``");

          // Check for actual usage with code-like context
          if (referenceRegex.test(lineWithoutStrings)) {
            // If it's a generic method name (update, create), ignore prisma/db calls
            if (isGeneric) {
              if (lineWithoutStrings.includes(`.database.`) || lineWithoutStrings.includes(`.prisma.`) || lineWithoutStrings.includes(`.db.`)) {
                continue;
              }
            }

            if (codePattern.test(lineWithoutStrings)) {
              if (process.env.DEBUG_PRUNY) {
                console.log(`[DEBUG USE] ${exp.name} used internally in ${file} at line ${i + 1}: ${line.trim()}`);
              }
              usedInternally = true;
              // Don't set isUsed here — let external check run so we can report
              // exports that are used internally but never imported from outside.
              break;
            }
          }
        }
      }

      // Per-export patterns, compiled once instead of once per file
      const selfImportPattern = new RegExp(`import.*\\b${escapedName}\\b.*from`);
      const selfDeclPattern = new RegExp(
        `(?:export\\s+)?(?:abstract\\s+)?(?:interface|class|enum)\\s+${escapedName}\\b|` +
        `(?:export\\s+)?(?:async\\s+)?(?:function)\\s+${escapedName}\\b|` +
        `(?:export\\s+)?(?:const|let|var|type)\\s+${escapedName}\\s*[=<]`
      );
      const dynamicImportMemberPattern = new RegExp(`\\.${escapedName}\\b`);
      const jsxPattern = new RegExp(`<${exp.name}[\\s/>]`);
      const importPattern = new RegExp(`import.*\\b${exp.name}\\b.*from`);
      const wordBoundaryPattern = new RegExp(`\\b${exp.name}\\b`);
      const ownApp = APP_DIR_REGEX.exec(absoluteFile)?.[1];

      // Then check external usage (in other files) — only files containing the name
      const candidateIdx = WORD_TOKEN_REGEX.test(exp.name)
        ? (refFiles.tokenIndex.get(exp.name) ?? [])
        : refFiles.allIdx;

      for (const idx of candidateIdx) {
        const ref = refFiles.files[idx];
        if (file === ref.rel) continue;
        const content = ref.content;

        // Monorepo Isolation Logic:
        // If candidate is in an app (apps/x), do NOT check usage in other apps (apps/y).
        // Shared packages (packages/z) are still checked globally.
        if (ownApp && ref.app && ownApp !== ref.app) continue;

        const fileIgnoreRanges = ignoreRanges.get(ref.path);

        // Skip files that declare the same name without importing it — those are
        // independent re-declarations (e.g., duplicate interface names across service files),
        // not usages of the export we're checking.
        const hasSelfImport = selfImportPattern.test(content);
        const hasSelfDecl = selfDeclPattern.test(content);
        // Exception: lazy(() => import('...').then(mod => mod.Name)) — the local const wraps
        // a dynamic import that consumes the named export. Don't skip these files.
        const hasDynamicImportRef = ref.hasDynamicImport && dynamicImportMemberPattern.test(content);
        if (hasSelfDecl && !hasSelfImport && !hasDynamicImportRef) continue;

        if (!fileIgnoreRanges && !isGeneric) {
          // Fast path: Only if no ignore ranges exist for this file AND not a generic method
          if (jsxPattern.test(content)) {
            if (process.env.DEBUG_PRUNY) console.log(`[DEBUG USE] ${exp.name} used via JSX in ${ref.path}`);
            isUsed = true;
            break;
          }

          if (referenceRegex.test(getContentWithoutStrings(ref))) {
             if (process.env.DEBUG_PRUNY) console.log(`[DEBUG USE] ${exp.name} used via fast-path regex in ${ref.path}`);
             isUsed = true;
             break;
          }
        }

        // Import usage: import { ExportName } from
        if (importPattern.test(content)) {
          if (process.env.DEBUG_PRUNY) {
            console.log(`[DEBUG USE] ${exp.name} used via import in ${ref.path}`);
          }
          isUsed = true;
          break;
        }

        // For other potential usage, use word boundary check but exclude obvious false positives
        if (wordBoundaryPattern.test(content)) {
          // Found potential match - verify it's in actual code, not strings/comments
          const lines = getLines(ref);
          let inMultilineComment = false;
          let inTemplateLiteral = false;

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            // Check if this line should be ignored (cascading deletion)
            if (fileIgnoreRanges?.some(r => (lineIndex + 1) >= r.start && (lineIndex + 1) <= r.end)) {
              continue;
            }

            const line = lines[lineIndex];
            const trimmed = line.trim();

            // Track multi-line comment state
            if (trimmed.includes('/*')) inMultilineComment = true;
            if (trimmed.includes('*/')) {
              inMultilineComment = false;
              continue;
            }
            if (inMultilineComment) continue;

            // Track template literal state (multi-line strings with backticks)
            const backtickCount = (line.match(/`/g) || []).length;
            if (backtickCount % 2 !== 0) {
              inTemplateLiteral = !inTemplateLiteral;
            }
            if (inTemplateLiteral) continue;

            // Skip single-line comments
            if (trimmed.startsWith('//')) continue;

            // Skip text inside single or double quotes (simple check)
            // Replace strings with placeholders to avoid matching words inside them
            const lineWithoutStrings = line
              .replace(/'[^']*'/g, "''")
              .replace(/"[^"]*"/g, '""');

            // Simple check: if line contains the export name AND looks like code
            // (has code-like patterns: function calls, property access, generics, etc.)
            if (wordBoundaryPattern.test(line)) {
              if (isGeneric) {
                  if (lineWithoutStrings.includes(`.database.`) || lineWithoutStrings.includes(`.prisma.`) || lineWithoutStrings.includes(`.db.`) || lineWithoutStrings.includes(`.databaseService.`)) {
                       continue;
                  }

                  // Heuristic: If method is generic, ensure the file likely imports/references the service/module
                  // E.g. if exp.file is 'branch.service.ts', look for 'BranchService' or 'branch.service' in content
                  // This avoids matching 'update' from totally unrelated services
                  const fileName = parse(exp.file).name; // branch.service
                  const parts = fileName.split('.');
                  const baseName = parts[0]; // branch

                  // Construct likely class name: branch -> BranchService (if .service)
                  // or just 'Branch'
                  let likelyRef: string;
                  if (fileName.includes('.service')) {
                      likelyRef = baseName.replace(/(?:^|-)(\w)/g, (_, c) => c.toUpperCase()) + 'Service';
                  } else if (fileName.includes('.controller')) {
                      likelyRef = baseName.replace(/(?:^|-)(\w)/g, (_, c) => c.toUpperCase()) + 'Controller';
                  } else {
                      likelyRef = baseName;
                  }

                  // Also check for the filename usage in imports (e.g. from './branch.service')
                  const importRef = fileName;

                  if (likelyRef && !content.includes(likelyRef) && !content.includes(importRef)) {
                      // If the file doesn't mention the service class or filename, it probably doesn't use its generic methods
                      continue;
                  }
              }

              if (codePattern.test(lineWithoutStrings)) {
                if (process.env.DEBUG_PRUNY) {
                  console.log(`[DEBUG USE] ${exp.name} used in ${ref.path} at line ${lineIndex + 1}: ${line.trim()}`);
                }
                isUsed = true;
                break;
              }
            }
          }
        }

        if (isUsed) break;
      } // End of reference files loop

      if (!isUsed) {
        unusedExports.push({ ...exp, usedInternally });
      }
    }
  }

  if (!options.silent) {
    process.stdout.write(` ${unusedExports.length} unused\n`);
  }

  return {
    total: allExportsCount,
    used: allExportsCount - unusedExports.length,
    unused: unusedExports.length,
    exports: unusedExports
  };
}



const APP_DIR_REGEX = /\/apps\/([^/]+)\//;
const WORD_TOKEN_REGEX = /^\w+$/;

interface ReferenceFile {
  path: string;
  rel: string;
  content: string;
  app: string | undefined;
  hasDynamicImport: boolean;
  lines?: string[];
  contentWithoutStrings?: string;
}

/**
 * Build per-file data once plus an inverted index of `\w+` tokens -> file indexes.
 * `\bname\b` can only match a file whose content has `name` as a maximal `\w+` run,
 * so the index gives the exact set of files worth checking for a `\w+` name.
 */
function buildReferenceIndex(totalContents: Map<string, string>, rootDir: string) {
  const files: ReferenceFile[] = [];
  const tokenIndex = new Map<string, number[]>();

  for (const [path, content] of totalContents) {
    const idx = files.length;
    files.push({
      path,
      rel: relative(rootDir, path),
      content,
      app: APP_DIR_REGEX.exec(path)?.[1],
      hasDynamicImport: /import\s*\(/.test(content),
    });
    for (const token of new Set(content.match(/\w+/g))) {
      const list = tokenIndex.get(token);
      if (list) list.push(idx);
      else tokenIndex.set(token, [idx]);
    }
  }

  return { files, tokenIndex, allIdx: files.map((_, i) => i) };
}

function getLines(file: ReferenceFile): string[] {
  return (file.lines ??= file.content.split('\n'));
}

function getContentWithoutStrings(file: ReferenceFile): string {
  return (file.contentWithoutStrings ??= file.content
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""'));
}

/**
 * Simplified logic to find the end of a method block by counting braces
 */
function findMethodEnd(lines: string[], startLine: number): number {
  let braceCount = 0;
  let foundOpen = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const cleanLine = sanitizeLine(line);

    const open = (cleanLine.match(/{/g) || []).length;
    const close = (cleanLine.match(/}/g) || []).length;
    
    if (open > 0) foundOpen = true;
    braceCount += open - close;
    
    if (foundOpen && braceCount <= 0) return i;
  }
  return startLine;
}

