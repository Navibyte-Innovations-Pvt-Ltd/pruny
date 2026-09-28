/**
 * Shared utility functions used across scanners, workers, and fixers.
 * Single source of truth — avoids duplication across modules.
 */

import { isAbsolute, join, resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Minimatch, type MinimatchOptions } from 'minimatch';

export type AppFramework = 'nextjs' | 'nestjs' | 'expo' | 'react-native' | 'unknown';

/**
 * Detect the framework of an app by reading its package.json dependencies.
 */
export function detectAppFramework(appDir: string): AppFramework[] {
  const pkgPath = join(appDir, 'package.json');
  if (!existsSync(pkgPath)) return ['unknown'];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const frameworks: AppFramework[] = [];
    if (allDeps['next']) frameworks.push('nextjs');
    if (allDeps['@nestjs/core'] || allDeps['@nestjs/common']) frameworks.push('nestjs');
    if (allDeps['expo']) frameworks.push('expo');
    else if (allDeps['react-native']) frameworks.push('react-native');

    return frameworks.length > 0 ? frameworks : ['unknown'];
  } catch {
    return ['unknown'];
  }
}
import type { Config } from './types.js';

/**
 * Sanitize a line by removing string literals and comments for safe brace counting.
 * Handles escaped chars, single/double/template strings, single-line and inline block comments.
 */
export function sanitizeLine(line: string): string {
  return line
    .replace(/\\./g, '__')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*/, '')
    .replace(/\/\*.*?\*\//g, '');
}

/**
 * Resolve a potentially relative file path to absolute using the config's root directory.
 */
export function resolveFilePath(filePath: string, config: Config): string {
  if (isAbsolute(filePath)) return filePath;
  const root = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
  return join(root, filePath);
}

/**
 * Extract the app/package name from a relative file path.
 * e.g., "apps/my-app/src/foo.ts" -> "apps/my-app"
 */
export function getAppName(filePath: string): string {
  if (filePath.startsWith('apps/')) return filePath.split('/').slice(0, 2).join('/');
  if (filePath.startsWith('packages/')) return filePath.split('/').slice(0, 2).join('/');
  return 'Root';
}

/**
 * Build a regex that checks if an export name appears in a code-like context.
 * Handles: function calls, property access, generics, type annotations, assignments, array types, etc.
 */
export function makeCodePattern(name: string): RegExp {
  const escaped = escapeRegExp(name);
  return new RegExp(
    `\\b${escaped}\\s*[({.,;<>|&\\[=)]` +
    `|\\b${escaped}\\s*\\)` +
    `|\\.[\\s\\n]*${escaped}\\b` +
    `|\\b${escaped}\\s*:[^:]` +
    `|:\\s*${escaped}\\b` +
    `|<\\/?${escaped}(?=[\\s/>]|$)`  // JSX: <Component or </Component (possibly at line end)
  );
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip single-line (//) and block (slash-star) comments from source text.
 *
 * This is used before scanning file content for import/reference patterns so
 * that commented-out imports are NOT treated as active references, which would
 * cause dead files to appear "used".
 *
 * The function operates on an in-memory copy only — the original file on disk
 * is never modified.
 *
 * Limitation: "//" inside a string literal (e.g. "https://...") will also be
 * stripped. This is acceptable because such strings are never import specifiers,
 * so no false positives are introduced.
 */
export function stripComments(content: string): string {
  // Remove block comments first (including multiline /* ... */)
  let result = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments (preserve line endings for line-number tracking)
  result = result.replace(/\/\/[^\n]*/g, '');
  return result;
}

/**
 * Check if a path matches a filter pattern (case-insensitive).
 */
export function matchesFilter(path: string, filter: string): boolean {
  const lowerPath = path.toLowerCase();
  const appName = getAppName(path).toLowerCase();
  if (appName.includes(filter)) return true;
  const segments = lowerPath.split('/');
  for (const segment of segments) {
    if (segment === filter) return true;
    const withoutExt = segment.replace(/\.[^.]+$/, '');
    if (withoutExt === filter) return true;
  }
  return lowerPath.includes(filter);
}

/**
 * Parse tsconfig.json/jsconfig.json to extract path aliases.
 * Returns a Map of alias prefix -> array of absolute resolution directories.
 * Handles `extends` for local files and `baseUrl`.
 *
 * Example: { "@components/*": ["./src/components/*"] }
 * Becomes: Map { "@components/" => ["/abs/path/src/components"] }
 */
export function parseTsConfigPaths(searchDir: string): Map<string, string[]> {
  const aliasMap = new Map<string, string[]>();
  const absSearchDir = resolve(searchDir);

  const configNames = ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json'];
  let configPath: string | null = null;

  for (const name of configNames) {
    const candidate = join(absSearchDir, name);
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) return aliasMap;

  try {
    const parsed = readTsConfigWithExtends(configPath);
    const baseUrl = parsed.baseUrl ? resolve(dirname(configPath), parsed.baseUrl) : dirname(configPath);
    const paths = parsed.paths;

    if (!paths) return aliasMap;

    for (const [pattern, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets)) continue;

      // Convert "alias/*" -> "alias/" prefix, "@/*" -> "@/" prefix
      const prefix = pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern;

      const resolvedTargets: string[] = [];
      for (const target of targets) {
        // Convert "./src/components/*" -> "/abs/path/src/components"
        const cleanTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
        resolvedTargets.push(resolve(baseUrl, cleanTarget));
      }

      aliasMap.set(prefix, resolvedTargets);
    }
  } catch {
    // Ignore parse errors
  }

  return aliasMap;
}

/**
 * Read a tsconfig.json and recursively resolve local `extends`.
 * Returns merged compilerOptions with paths and baseUrl.
 */
function readTsConfigWithExtends(configPath: string): { paths?: Record<string, string[]>; baseUrl?: string } {
  try {
    // Strip JSON comments and trailing commas for tsconfig tolerance.
    // String literals are captured by the first alternative and returned as-is,
    // so `/*` or `//` sequences inside strings (e.g. the common "@/*": ["./*"]
    // path alias) are preserved rather than being misread as comment markers.
    const raw = readFileSync(configPath, 'utf-8');
    const cleaned = raw
      .replace(
        /("(?:\\.|[^"\\])*")|\/\/.*$|\/\*[\s\S]*?\*\//gm,
        (_m, str) => (str as string | undefined) ?? ''
      )
      .replace(/,(\s*[}\]])/g, '$1');
    const config = JSON.parse(cleaned);

    let basePaths: Record<string, string[]> = {};
    let baseUrl: string | undefined;

    // Follow local extends (skip node_modules packages)
    if (config.extends && !config.extends.startsWith('@') && !config.extends.startsWith('node_modules')) {
      const extendsPath = resolve(dirname(configPath), config.extends);
      // Add .json extension if missing
      const extendsFile = existsSync(extendsPath) ? extendsPath : extendsPath + '.json';
      if (existsSync(extendsFile)) {
        const parent = readTsConfigWithExtends(extendsFile);
        if (parent.paths) basePaths = { ...parent.paths };
        if (parent.baseUrl) baseUrl = parent.baseUrl;
      }
    }

    // Override with local compilerOptions
    if (config.compilerOptions?.paths) {
      basePaths = { ...basePaths, ...config.compilerOptions.paths };
    }
    if (config.compilerOptions?.baseUrl) {
      baseUrl = config.compilerOptions.baseUrl;
    }

    return { paths: Object.keys(basePaths).length > 0 ? basePaths : undefined, baseUrl };
  } catch {
    return {};
  }
}

const globCache = new Map<string, Minimatch | null>();

/**
 * Same result as `minimatch(path, pattern, options)`, but each pattern is compiled
 * once and reused. Route matching calls this routes × references times; compiling
 * the glob on every call was the dominant cost after the exports index.
 */
export function matchGlob(path: string, pattern: string, options?: MinimatchOptions): boolean {
  const key = options ? `${pattern}\0${JSON.stringify(options)}` : pattern;
  let mm = globCache.get(key);
  if (mm === undefined) {
    // minimatch(): comments match nothing (unless nocomment)
    mm = !options?.nocomment && pattern.charAt(0) === '#' ? null : new Minimatch(pattern, options);
    globCache.set(key, mm);
  }
  return mm ? mm.match(path) : false;
}

let fileCache: Map<string, string> | null = null;

/**
 * Start a fresh shared file-content cache, reused by every scanner and every app
 * until the next call. Only safe while nothing modifies files (report / CI / --json),
 * so it is off by default and fix mode never enables it.
 */
export function startFileCache(): void {
  fileCache = new Map();
}

export function isFileCacheActive(): boolean {
  return fileCache !== null;
}

/** readFileSync(path, 'utf-8'), served from the shared cache when enabled. */
export function readSourceFile(path: string): string {
  if (!fileCache) return readFileSync(path, 'utf-8');
  let content = fileCache.get(path);
  if (content === undefined) {
    content = readFileSync(path, 'utf-8');
    fileCache.set(path, content);
  }
  return content;
}
