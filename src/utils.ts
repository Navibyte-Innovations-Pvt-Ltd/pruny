/**
 * Shared utility functions used across scanners, workers, and fixers.
 * Single source of truth — avoids duplication across modules.
 */

import { isAbsolute, join, resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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
    `|:\\s*${escaped}\\b`
  );
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    // Strip JSON comments and trailing commas for tsconfig tolerance
    const raw = readFileSync(configPath, 'utf-8');
    const cleaned = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
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
