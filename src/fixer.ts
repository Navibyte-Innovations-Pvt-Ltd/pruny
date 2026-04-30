import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import fg from 'fast-glob';
import type { UnusedExport } from './types.js';
import { DEFAULT_IGNORE } from './constants.js';
import { sanitizeLine } from './utils.js';

/**
 * Check if a service method is used elsewhere in the codebase (outside of the calling controller)
 * This is critical for cascading deletion to avoid removing methods that are used by other routes
 */
export function isServiceMethodUsedElsewhere(
  serviceFile: string,
  serviceMethod: string,
  callingControllerPath: string,
  projectRoot: string
): boolean {
  if (!existsSync(serviceFile)) return false;

  // Get the service class name from the file
  const serviceContent = readFileSync(serviceFile, 'utf-8');
  const classMatch = serviceContent.match(/export\s+class\s+(\w+)/);
  if (!classMatch) return false;
  const serviceClassName = classMatch[1];

  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG isServiceMethodUsedElsewhere] Checking ${serviceMethod} in ${serviceClassName} (${serviceFile})`);
  }

  // Find all TypeScript files in the project
  const allFiles = fg.sync('**/*.{ts,tsx}', {
    cwd: projectRoot,
    ignore: DEFAULT_IGNORE,
    absolute: true
  });

  // Check each file for usage of the service method
  for (const file of allFiles) {
    // Skip the service file itself (internal usage is OK)
    if (file === serviceFile) continue;

    // Skip the calling controller (we know it's being deleted)
    if (file === callingControllerPath) continue;

    try {
      const content = readFileSync(file, 'utf-8');

      // Check if this file imports the service
      const importRegex = new RegExp(`import.*\\b${serviceClassName}\\b.*from`);
      if (!importRegex.test(content)) continue;

      if (process.env.DEBUG_PRUNY) {
        console.log(`[DEBUG isServiceMethodUsedElsewhere] Found import of ${serviceClassName} in ${file}`);
      }

      // Find all service property names in the constructor
      // Pattern: constructor(private readonly propName: ServiceClass
      // or: constructor(public propName: ServiceClass
      const constructorMatch = content.match(/constructor\s*\(([^)]+)\)/);
      if (constructorMatch) {
        const params = constructorMatch[1];
        const serviceProps: string[] = [];

        for (const param of params.split(',')) {
          // Handle patterns like: private readonly plansService: PlansService
          // or: private plansService: PlansService
          // or: readonly plansService: PlansService
          const propMatch = param.match(/(?:public|private|protected|readonly)?\s*(?:public|private|protected|readonly)?\s*(\w+)\s*:\s*\w+/);
          if (propMatch) {
            const propName = propMatch[1];
            const propType = param.split(':')[1]?.trim().split(/[<>\s]/)[0];
            if (propType === serviceClassName) {
              serviceProps.push(propName);
              if (process.env.DEBUG_PRUNY) {
                console.log(`[DEBUG isServiceMethodUsedElsewhere] Found property ${propName}: ${serviceClassName} in ${file}`);
              }
            }
          }
        }

        for (const propName of serviceProps) {
          // Check for method call: this.propName.methodName(
          const methodCallRegex = new RegExp(`this\\.${propName}\\.${serviceMethod}\\s*\\(`);
          if (methodCallRegex.test(content)) {
            if (process.env.DEBUG_PRUNY) {
              console.log(`[DEBUG isServiceMethodUsedElsewhere] Found ${serviceMethod} used via this.${propName}.${serviceMethod}() in ${file}`);
            }
            return true;
          }
        }
      }

      // Also check for any this.*.methodName( pattern as a fallback
      // This catches cases where the constructor parsing might fail
      const anyMethodCallRegex = new RegExp(`this\\.\\w+\\.${serviceMethod}\\s*\\(`);
      if (anyMethodCallRegex.test(content)) {
        // Verify it's for the right service by checking if the file imports it
        if (process.env.DEBUG_PRUNY) {
          console.log(`[DEBUG isServiceMethodUsedElsewhere] Found ${serviceMethod} used via fallback pattern in ${file}`);
        }
        return true;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return false;
}

/**
 * Resolve an imported class to its file path
 */
export function resolveImport(filePath: string, className: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');

  // 1. Match import { ClassName } from './path'
  const namedImportRegex = new RegExp(`import\\s+\\{[^}]*\\b${className}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`);
  const namedMatch = content.match(namedImportRegex);

  if (namedMatch && namedMatch[1]) {
    return resolvePath(filePath, namedMatch[1]);
  }

  // 2. Match import ClassName from './path' (Default import)
  const defaultImportRegex = new RegExp(`import\\s+${className}\\s+from\\s+['"]([^'"]+)['"]`);
  const defaultMatch = content.match(defaultImportRegex);

  if (defaultMatch && defaultMatch[1]) {
    return resolvePath(filePath, defaultMatch[1]);
  }

  return null;
}

function resolvePath(currentFile: string, importPath: string): string {
  const dir = dirname(currentFile);
  const resolved = join(dir, importPath);

  // Handle extensionless imports
  if (!existsSync(resolved)) {
    if (existsSync(resolved + '.ts')) return resolved + '.ts';
    if (existsSync(resolved + '.js')) return resolved + '.js';
    if (existsSync(resolved + '/index.ts')) return resolved + '/index.ts';
  }
  return resolved;
}

/**
 * Analyze a controller method to find which service method it calls
 * Returns: { serviceFile: string, serviceMethod: string } | null
 */
export function findServiceMethodCall(controllerPath: string, controllerMethod: string, approximateLine = 0): { serviceFile: string, serviceMethod: string } | null {
  if (!existsSync(controllerPath)) return null;
  const content = readFileSync(controllerPath, 'utf-8');
  const lines = content.split('\n');

  // 1. Find method body
  const lineIndex = findDeclarationIndex(lines, controllerMethod, approximateLine);
  if (lineIndex === -1) return null;

  const start = lineIndex;
  const end = Math.min(lines.length, start + 50);
  const bodySlice = lines.slice(start, end).join('\n');

  // 2. Match `this.serviceName.methodName(`
  // We first need to find the property name of the service in the constructor
  // Constructor: constructor(private readonly authService: AuthService)

  const constructorMatch = content.match(/constructor\s*\(([^)]+)\)/);
  if (!constructorMatch) return null;

  const params = constructorMatch[1];
  // Parse params: private readonly authService: AuthService
  const serviceProps: { name: string; type: string }[] = [];

  for (const param of params.split(',')) {
    const parts = param.trim().split(':');
    if (parts.length === 2) {
      const propName = parts[0].replace(/public|private|protected|readonly|\s/g, '');
      const propType = parts[1].trim();
      serviceProps.push({ name: propName, type: propType });
    }
  }

  // Now look for usage in body: this.propName.methodName
  for (const prop of serviceProps) {
    const usageRegex = new RegExp(`this\\.${prop.name}\\.([a-zA-Z0-9_]+)\\(`);
    const usageMatch = bodySlice.match(usageRegex);

    if (usageMatch && usageMatch[1]) {
      const serviceMethod = usageMatch[1];
      // Resolve service file
      const serviceFile = resolveImport(controllerPath, prop.type);
      if (serviceFile) {
        if (process.env.DEBUG_PRUNY) console.log(`[DEBUG findServiceMethodCall] Found ${serviceMethod} in ${serviceFile}`);
        return { serviceFile, serviceMethod };
      }
    }
  }

  return null;
}


/**
 * Find a method's line number (1-indexed) in a file.
 * Used for directly locating service methods for cascading deletion.
 */
export function findMethodLine(filePath: string, methodName: string): number | null {
  if (!existsSync(filePath)) {
    if (process.env.DEBUG_PRUNY) console.log(`[DEBUG findMethodLine] File not found: ${filePath}`);
    return null;
  }
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const idx = findDeclarationIndex(lines, methodName, 0);
  if (process.env.DEBUG_PRUNY) console.log(`[DEBUG findMethodLine] ${methodName} in ${filePath} -> idx=${idx}`);
  if (idx === -1) return null;
  return idx + 1; // Convert 0-indexed to 1-indexed
}

/**
 * Removes the 'export ' prefix from a specific line in a file,
 * OR deletes the entire declaration if it's dead code (not used internally)
 */
export function removeExportFromLine(rootDir: string, exp: UnusedExport): boolean {
  const fullPath = join(rootDir, exp.file);
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Try narrow search first (near the recorded line), then full-file fallback.
    // Block exports (`export { X, Y }`) record the export line, not the declaration line,
    // so a narrow search may miss the actual `const X = ...` declaration.
    let lineIndex = findDeclarationIndex(lines, exp.name, exp.line - 1);
    if (lineIndex === -1) {
      lineIndex = findDeclarationIndex(lines, exp.name, 0);
    }

    if (!exp.usedInternally) {
      if (lineIndex === -1) {
        // Only in a block export — remove the name from the export { ... } list
        return removeFromBlockExport(lines, fullPath, exp.name, exp.line);
      }
      const trueStartLine = findDeclarationStart(lines, lineIndex);
      const deletedLines = deleteDeclaration(lines, trueStartLine, exp.name);

      if (deletedLines > 0) {
        // Also strip from block export if present
        removeFromBlockExport(lines, fullPath, exp.name, exp.line);
        const newContent = lines.join('\n');
        if (isFileEmpty(newContent)) {
          unlinkSync(fullPath);
        } else {
          writeFileSync(fullPath, newContent, 'utf-8');
        }
        return true;
      }
      return false;
    }

    // usedInternally = true: just remove the `export` keyword, keep the declaration.
    if (lineIndex === -1) {
      // Declaration not found — name is only in a block export; remove it from there
      return removeFromBlockExport(lines, fullPath, exp.name, exp.line);
    }

    const originalLine = lines[lineIndex];
    if (!originalLine) return false;

    if (originalLine.trim().startsWith('export ')) {
      const newLine = originalLine.replace(/(\s*)export\s+/, '$1');
      lines[lineIndex] = newLine;
      writeFileSync(fullPath, lines.join('\n'), 'utf-8');
      return true;
    }

    // Declaration found but no `export` keyword on its line — it may be in a block export
    return removeFromBlockExport(lines, fullPath, exp.name, exp.line);
  } catch (err) {
    console.error(`Error fixing export in ${exp.file}:`, err);
    return false;
  }
}

/**
 * Remove a single name from a block export statement: export { X, Y, Z }
 * If the export becomes empty, remove the line entirely.
 */
function removeFromBlockExport(lines: string[], fullPath: string, name: string, exportLine: number): boolean {
  const lineIdx = exportLine - 1;
  const line = lines[lineIdx];
  if (!line) return false;
  if (!/^export\s*\{/.test(line.trim())) return false;

  // Remove the name (with optional trailing comma/space or preceding comma/space)
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let newLine = line
    .replace(new RegExp(`\\b${escaped}\\b\\s*,\\s*`), '') // "Name, "
    .replace(new RegExp(`,\\s*\\b${escaped}\\b`), '')      // ", Name"
    .replace(new RegExp(`\\b${escaped}\\b`), '');           // lone "Name"

  // Normalize spacing inside braces
  newLine = newLine.replace(/\{\s*\}/, '{}').replace(/\{\s+/, '{ ').replace(/\s+\}/, ' }');

  if (newLine.trim() === 'export {}' || newLine.trim() === 'export { }') {
    lines.splice(lineIdx, 1);
  } else {
    lines[lineIdx] = newLine;
  }

  writeFileSync(fullPath, lines.join('\n'), 'utf-8');
  return true;
}

/**
 * Find the actual line index for a declaration, handling shifts
 */
export function findDeclarationIndex(lines: string[], name: string, startLine = 0): number {
  // Match method/function declarations: name(
  const methodRegex = new RegExp(`(?:public|private|protected|static|async|readonly)?\\s*(?:async)?\\s*${name}\\s*[(<]`);
  // Match class/interface/type/enum/const declarations: class Name, const Name, etc.
  // Allows optional async/static modifiers between export and the declaration keyword
  const declRegex = new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:(?:abstract|async|static|readonly)\\s+)*(?:class|interface|type|enum|function|const|let|var)\\s+${name}\\b`);

  // Start slightly before to be safe (e.g. 10 lines back)
  const actualStart = Math.max(0, startLine - 10);

  for (let i = actualStart; i < lines.length; i++) {
    if (methodRegex.test(lines[i]) || declRegex.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Find the true start of a declaration, including preceding decorators
 */
export function findDeclarationStart(lines: string[], lineIndex: number): number {
  if (lineIndex < 0 || lineIndex >= lines.length) return lineIndex;
  let current = lineIndex;

  while (current > 0) {
    const prevLine = lines[current - 1].trim();

    // Check for direct decorators or comments (including JSDoc)
    if (prevLine.startsWith('@') || prevLine.startsWith('//') || prevLine.startsWith('/*') || prevLine.startsWith('*') || prevLine.endsWith('*/')) {
      current--;
    }
    // Check for empty lines, but only if they are preceded by a decorator
    else if (prevLine === '') {
      let foundDecoratorAbove = false;
      for (let k = 1; k <= 3; k++) {
        if (current - 1 - k >= 0) {
          const checkLine = lines[current - 1 - k].trim();
          if (checkLine.startsWith('@') || checkLine.endsWith(')') || checkLine.endsWith('},')) {
            foundDecoratorAbove = true;
            break;
          }
          if (checkLine !== '') break;
        }
      }
      if (foundDecoratorAbove) {
        current--;
      } else {
        break;
      }
    }
    // Logic for multiline decorators ending with ), or },
    // A lone '}' is a method/block closing brace, NOT a decorator — stop scanning.
    else if (prevLine.endsWith(')') || prevLine.endsWith('},')) {
      let foundDecorator = false;
      let parenDepth = 0;
      let braceDepth = 0;

      // Scan upwards to find matching head
      for (let j = current - 1; j >= Math.max(0, current - 50); j--) {
        const l = lines[j];
        const cleanL = sanitizeLine(l);

        // Safety check: If we hit another method or class/function definition, STOP.
        if (/\b(class|constructor|function|interface|enum)\b/.test(cleanL) ||
          (/^[a-zA-Z0-9_$]+\s*\(/.test(l.trim()) && !l.trim().startsWith('@'))) {
          // console.log(`Hit barrier at ${j}: ${l.trim()}`);
          break;
        }

        const opensP = (cleanL.match(/\(/g) || []).length;
        const closesP = (cleanL.match(/\)/g) || []).length;
        const opensB = (cleanL.match(/\{/g) || []).length;
        const closesB = (cleanL.match(/\}/g) || []).length;

        parenDepth += closesP - opensP;
        braceDepth += closesB - opensB;

        if (parenDepth <= 0 && braceDepth <= 0 && l.trim().startsWith('@')) {
          current = j;
          foundDecorator = true;
          break;
        }
      }
      if (!foundDecorator) break;
    } else {
      break;
    }
  }

  return current;
}

/**
 * Delete an entire declaration starting from the given line
 */
export function deleteDeclaration(lines: string[], startLine: number, name: string | null): number {
  if (startLine < 0 || startLine >= lines.length) return 0;

  let endLine = startLine;
  let braceCount = 0;
  let parenCount = 0;
  let foundMethodDefinition = false;
  let foundBodyOpening = false;
  let foundClosing = false;

  // Stricter regex for declarations.
  // Allows: export + multiple modifiers (async, static, etc.) + declaration keyword (function, const, etc.) + identifier + ( or =
  // Example matches: `export async function GET(`, `async getData(`, `export const handler =`
  const declRegex = /^(?:export\s+)?(?:(?:public|private|protected|static|async|readonly|abstract|override)\s+)*(?:(?:class|interface|type|enum|function|const|let|var)\s+)?[a-zA-Z0-9_$]+(?:<[^>]+>)?\s*(?:\(|=[^=])/;

  // Match class/interface/type/enum declarations: export class Foo {, interface Bar {, type Baz =
  const classDeclRegex = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+[a-zA-Z0-9_$]+/;

  // Fallback for methods without keywords: name() {
  const methodRefRegex = name ? new RegExp(`^\\s*(?:export\\s+)?(?:(?:async|static|readonly)\\s+)*(?:function\\s+)?\\b${name}\\b\\s*\\(`) : null;

  let currentDecoratorParenDepth = 0;
  let currentDecoratorBraceDepth = 0;
  let inTemplateLiteral = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') continue;

    // Track multiline template literals — braces inside them (CSS/HTML) are not TypeScript
    const lineForBackticks = line
      .replace(/\\./g, '__')
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""');
    const backtickCount = (lineForBackticks.match(/`/g) || []).length;

    if (inTemplateLiteral) {
      if (backtickCount % 2 !== 0) {
        inTemplateLiteral = false; // Template literal ends on this line
        // Count braces AFTER the closing backtick (e.g. `}` in `${x}`})
        const lastTick = line.lastIndexOf('`');
        const afterTick = sanitizeLine(line.slice(lastTick + 1));
        const extraOpens = (afterTick.match(/{/g) || []).length;
        const extraCloses = (afterTick.match(/}/g) || []).length;
        braceCount += extraOpens - extraCloses;
        if (foundBodyOpening && braceCount <= 0) {
          endLine = i;
          foundClosing = true;
          break;
        }
      }
      continue; // Skip brace counting inside template literals
    }

    if (backtickCount % 2 !== 0) {
      inTemplateLiteral = true;
      // Process this line's braces (code before the backtick) but continue below
    }

    const isDecorator = trimmed.startsWith('@');

    const cleanLine = sanitizeLine(line);

    const openBraces = (cleanLine.match(/{/g) || []).length;
    const closeBraces = (cleanLine.match(/}/g) || []).length;
    const openParens = (cleanLine.match(/\(/g) || []).length;
    const closeParens = (cleanLine.match(/\)/g) || []).length;

    if (!foundMethodDefinition) {
      if (isDecorator || currentDecoratorParenDepth > 0 || currentDecoratorBraceDepth > 0) {
        currentDecoratorParenDepth += openParens - closeParens;
        currentDecoratorBraceDepth += openBraces - closeBraces;
      } else {
        // Check for actual declaration (skipping comments)
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          continue;
        }

        const isDecl = declRegex.test(trimmed);
        const isClassDecl = classDeclRegex.test(trimmed);
        const isRef = methodRefRegex && methodRefRegex.test(trimmed);

        if (isDecl || isClassDecl || isRef) {
          if (process.env.DEBUG_PRUNY) {
            console.log(`[FIXER DEBUG] Found method definition at line ${i + 1}: ${trimmed}`);
            console.log(`[FIXER DEBUG] Matched: decl=${isDecl}, ref=${isRef}`);
          }
          foundMethodDefinition = true;

          // Track braces for this line
          braceCount = openBraces - closeBraces;
          parenCount = openParens - closeParens;

          if (openBraces > 0 && parenCount === 0) {
            foundBodyOpening = true;
          }

          // Single-line method: opens and closes on the same line (e.g. `update() { }`)
          if (foundBodyOpening && braceCount <= 0) {
            endLine = i;
            foundClosing = true;
            break;
          }
        }
      }
    } else {
      braceCount += openBraces - closeBraces;
      parenCount += openParens - closeParens;

      if (!foundBodyOpening && openBraces > 0 && parenCount === 0) {
        foundBodyOpening = true;
      }

      if (foundBodyOpening && braceCount <= 0) {
        endLine = i;
        foundClosing = true;
        break;
      }

      if (!foundBodyOpening && trimmed.endsWith(';') && braceCount === 0 && parenCount === 0) {
        endLine = i;
        foundClosing = true;
        break;
      }
    }
  }

  if (foundClosing) {
    const linesToDelete = endLine - startLine + 1;
    lines.splice(startLine, linesToDelete);
    return linesToDelete;
  }
  return 0;
}

/**
 * Check if a file is effectively empty
 */
function isFileEmpty(content: string): boolean {
  return content.split('\n').every(line => {
    const t = line.trim();
    if (!t) return true;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return true;
    if (t.startsWith('import ')) return true;
    if (t === '"use client";' || t === '"use server";' || t === "'use client';" || t === "'use server';") return true;

    // Only safely ignore re-exports or type exports if we want to be strict
    // But honestly, if there is ANY export left, the file is likely NOT empty.

    return false;
  });
}



/**
 * Remove orphaned decorators (decorators with no method below them)
 * CRITICAL: Only remove decorators at class-level indentation (not inside method bodies)
 */
function cleanupOrphanedDecorators(lines: string[]): number {
  let removed = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      i++;
      continue;
    }

    // Found a potential decorator - but ONLY at class level (2-4 spaces indentation typically)
    if (trimmed.startsWith('@')) {
      // Check indentation - decorators inside methods have deeper indentation
      const indent = line.length - line.trimStart().length;

      // Class-level decorators typically have 2-4 spaces
      // Method body code has 6+ spaces
      // This is a heuristic but helps avoid false positives
      if (indent >= 6) {
        // Likely inside a method body, skip
        i++;
        continue;
      }

      // SAFETY: Explicitly ignore class-level decorators to prevent destroying class headers
      const CLASS_DECORATORS = new Set([
        '@ApiTags', '@Controller', '@Injectable', '@Module',
        '@Catch', '@WebSocketGateway', '@Resolver', '@Scalar'
      ]);
      // Check if line matches any class decorator
      const isClassDec = Array.from(CLASS_DECORATORS).some(d => trimmed.startsWith(d));

      if (isClassDec) {
        // Skip class decorators entirely
        i++;
        continue;
      }

      let decoratorEnd = i;
      let parenDepth = 0;
      let braceDepth = 0;

      // Scan forward to find the end of this decorator (could be multiline)
      for (let j = i; j < Math.min(lines.length, i + 20); j++) {
        const l = lines[j];
        const cleanL = l
          .replace(/\\./g, '__')
          .replace(/'[^']*'/g, "''")
          .replace(/"[^"]*"/g, '""')
          .replace(/`[^`]*`/g, "``")
          .replace(/\/\/.*/, '')
          .replace(/\/\*.*?\*\//g, '');

        const opensP = (cleanL.match(/\(/g) || []).length;
        const closesP = (cleanL.match(/\)/g) || []).length;
        const opensB = (cleanL.match(/\{/g) || []).length;
        const closesB = (cleanL.match(/\}/g) || []).length;

        parenDepth += opensP - closesP;
        braceDepth += opensB - closesB;

        decoratorEnd = j;

        // Decorator complete when depths return to 0
        // Decorator complete when depths return to 0
        if (parenDepth <= 0 && braceDepth <= 0) {
          break;
        }
      }

      // Check what comes after the decorator (within next 10 lines)
      let foundMethod = false;
      let foundClosingBrace = false;

      for (let j = decoratorEnd + 1; j < Math.min(lines.length, decoratorEnd + 10); j++) {
        const nextLine = lines[j].trim();
        if (nextLine === '') continue;

        // Another decorator - not orphaned
        if (nextLine.startsWith('@')) {
          foundMethod = true;
          break;
        }


        // A method definition or property - assume valid target!
        // If it's NOT a closing brace `}`, and NOT a decorator (handled above), it must be code.
        if (nextLine !== '}') {
          foundMethod = true;
          break;
        }

        // Class closing brace - orphaned!
        if (nextLine === '}') {
          foundClosingBrace = true;
          break;
        }

        // Redundant check removed (class/interface keyword handled by "not }" logic)
      }

      // Only delete if we found a closing brace and no method
      if (foundClosingBrace && !foundMethod) {
        const linesToRemove = decoratorEnd - i + 1;
        lines.splice(i, linesToRemove);
        removed += linesToRemove;
        // Don't increment i, check the same position again
        continue;
      }
    }

    i++;
  }

  return removed;
}

// Helper to clean up structural syntax errors (unmatched braces)
function cleanupStructure(lines: string[]) {
  let braceDepth = 0;
  let inTemplateLiteral = false;
  let insideClassBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track multiline template literals — braces inside them (CSS/HTML) are NOT TypeScript braces
    const lineForBackticks = line
      .replace(/\\./g, '__')
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""');
    const backtickCount = (lineForBackticks.match(/`/g) || []).length;

    if (inTemplateLiteral) {
      // Inside a multiline template literal — skip brace counting
      if (backtickCount % 2 !== 0) {
        inTemplateLiteral = false; // Template literal ends on this line
      }
      continue;
    }

    // Check if a multiline template literal starts on this line
    if (backtickCount % 2 !== 0) {
      inTemplateLiteral = true;
      // Still process this line's braces (code before the backtick)
    }

    const cleanL = sanitizeLine(line);

    const opens = (cleanL.match(/{/g) || []).length;
    const closes = (cleanL.match(/}/g) || []).length;

    // Track when we enter a class body (so we can detect premature class closes)
    // Only class declarations at the top level (braceDepth 0) matter here
    if (braceDepth === 0 && opens > 0 && /\b(export\s+)?class\b/.test(cleanL)) {
      insideClassBody = true;
    }

    // Check for excess closing braces
    if (braceDepth + opens < closes) {
      if (/^\s*[})\];,]+\s*$/.test(line)) {
        // Check if this is likely the file end
        const isLastLine = i >= lines.length - 1 || lines.slice(i + 1).every(l => !l.trim());
        if (isLastLine && line.trim() === '}') {
          continue;
        }

        lines.splice(i, 1);
        i--;
        continue;
      }
    }

    // Delete orphan garbage "]" regardless of depth (safe for Controllers)
    if (/^\s*\]\s*$/.test(line)) {
      lines.splice(i, 1);
      i--;
      continue;
    }

    // Delete orphan garbage at root level (depth 0)
    // e.g. "];" or "]" or ")"
    if (braceDepth === 0 && opens === 0 && closes === 0) {
      if (/^\s*[})\];,]+\s*$/.test(line)) {
        lines.splice(i, 1);
        i--;
        continue;
      }
    }

    // Check if this line CLOSEs the class prematurely
    // ONLY applies inside a class body — top-level interface/enum/type closing braces are valid
    if (insideClassBody && braceDepth + opens - closes === 0 && closes > opens) {
      const hasCodeAfter = lines.slice(i + 1).some(l => l.trim() !== '');
      if (hasCodeAfter) {
        if (/^\s*[})\];,]+\s*$/.test(line)) {
          lines.splice(i, 1);
          i--;
          continue;
        }
      }
    }

    braceDepth += (opens - closes);

    // When braceDepth returns to 0, we've exited the class body
    if (braceDepth <= 0) {
      insideClassBody = false;
    }
  }

  // If bracedepth > 0 at EOF (missing closing braces), append them
  if (braceDepth > 0) {
    for (let k = 0; k < braceDepth; k++) {
      lines.push('}');
    }
  }
}

/**
 * Removes a specific method from a route file
 */
export function removeMethodFromRoute(rootDir: string, filePath: string, methodName: string, lineNum: number): boolean {

  const fullPath = isAbsolute(filePath) ? filePath : join(rootDir, filePath);
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // 1. Find the target line index (handle shifts)
    let targetIndex = findDeclarationIndex(lines, methodName, lineNum - 1);

    // Fallback: If not found at expected line (due to shifts), search from start
    if (targetIndex === -1) {
      targetIndex = findDeclarationIndex(lines, methodName, 0);
    }

    if (targetIndex === -1) {
      return false;
    }

    // 2. Find the true start (including decorators)
    const trueStartLine = findDeclarationStart(lines, targetIndex);

    // 3. Delete the block
    const deletedLines = deleteDeclaration(lines, trueStartLine, methodName);


    if (deletedLines > 0) {
      // 4. Clean up any orphaned decorators left behind (iteratively for chains)
      // BUT safely skip class decorators to avoid destroying class headers
      let cleaned = 0;
      let iterations = 0;
      do {
        // Only run if we trust it won't delete class headers
        // Modified cleanupOrphanedDecorators logic must be injected or assumed safe?
        // Wait, cleanupOrphanedDecorators is defined globally in file.
        // I need to modify THE FUNCTION DEFINITION, not just the call here.
        // But for now, enable loop. I will modify function definition in NEXT step.
        cleaned = cleanupOrphanedDecorators(lines);
        iterations++;
      } while (cleaned > 0 && iterations < 5); // Safety limit on iterations

      // 5. Clean up structural errors (extra/missing braces)
      cleanupStructure(lines);

      const newContent = lines.join('\n');
      if (isFileEmpty(newContent)) unlinkSync(fullPath);
      else writeFileSync(fullPath, newContent, 'utf-8');
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error removing method ${methodName} in ${filePath}:`, err);
    return false;
  }
}

/**
 * Find all service property names in a file for a specific service class
 */
export function findServiceProperties(content: string, serviceClassName: string): string[] {
  const serviceProps: string[] = [];
  
  // Find all service property names in the constructor
  // Pattern: constructor(private readonly propName: ServiceClass
  const constructorMatch = content.match(/constructor\s*\(([^)]+)\)/);
  if (constructorMatch) {
    const params = constructorMatch[1];
    for (const param of params.split(',')) {
      const propMatch = param.match(/(?:public|private|protected|readonly)?\s*(?:public|private|protected|readonly)?\s*(\w+)\s*:\s*(\w+)/);
      if (propMatch) {
        const propName = propMatch[1];
        const propType = propMatch[2];
        if (propType === serviceClassName) {
          serviceProps.push(propName);
        }
      }
    }
  }
  
  return serviceProps;
}

