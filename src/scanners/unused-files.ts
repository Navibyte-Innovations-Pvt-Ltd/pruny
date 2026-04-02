import fg from 'fast-glob';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import type { Config, UnusedFile } from '../types.js';
import { minimatch } from 'minimatch';
import { parseTsConfigPaths, detectAppFramework } from '../utils.js';

/**
 * Scan for unused source files (.ts, .tsx, .js, .jsx)
 * 
 * SCOPE:
 * - Candidates: Inside App Directory
 * - Usage Check: Inside App Directory (Local only, per user request)
 */
export async function scanUnusedFiles(config: Config): Promise<{ total: number; used: number; unused: number; files: UnusedFile[] }> {
  // Use appDir if specific scan, else config.dir
  const searchDir = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  process.stdout.write(`   📂 Scanning source files...`);

  // 1. Find all files in the search directory
  const allFiles = await fg(extGlob, {
    cwd: searchDir,
    ignore: [...config.ignore.folders, ...config.ignore.files],
    absolute: true
  });

  process.stdout.write(` ${allFiles.length} files found\n`);

  if (allFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, files: [] };
  }

  const allFilesSet = new Set(allFiles);

  // 2. Identify Entry Points
  const entryFiles = new Set<string>();
  const entryPatterns = [
    '**/page.{ts,tsx,js,jsx}',
    '**/layout.{ts,tsx,js,jsx}',
    '**/route.{ts,tsx,js,jsx}',
    '**/loading.{ts,tsx,js,jsx}',
    '**/error.{ts,tsx,js,jsx}',
    '**/not-found.{ts,tsx,js,jsx}',
    '**/template.{ts,tsx,js,jsx}',
    '**/default.{ts,tsx,js,jsx}', // Parallel routes
    '**/middleware.{ts,js}',
    '**/proxy.{ts,js}', // Proxy files are middleware-like entry points
    '**/instrumentation.{ts,js}',
    '**/next.config.{js,mjs,ts}',
    '**/tailwind.config.{js,ts,mjs,cjs}',
    '**/postcss.config.{js,ts,mjs,cjs}',
    '**/robots.{ts,js}',
    '**/sitemap.{ts,js}',
    '**/manifest.{ts,js}',
    '**/icon.{ts,tsx,js,jsx}',
    '**/apple-icon.{ts,tsx,js,jsx}',
    '**/opengraph-image.{ts,tsx,js,jsx}',
    '**/twitter-image.{ts,tsx,js,jsx}',
    '**/global-error.{ts,tsx,js,jsx}',
    '**/mdx-components.{ts,tsx,js,jsx}', // Next.js MDX convention
    '**/next-sitemap.config.{js,cjs}',
    '**/cypress.config.{ts,js}',
    '**/env.d.ts',
    '**/next-env.d.ts',
    '**/*.d.ts',
    '**/*.config.{js,ts,mjs,cjs}', // Generic config files
    '**/*.{test,spec,e2e-spec}.{ts,tsx,js,jsx}',
    'scripts/**/*.{ts,js}',
    'cypress/**/*.{ts,js,tsx}',
    '**/public/sw.js',
    '**/sw.{js,ts}',
    '**/main.{ts,js}',
    'api/index.ts',
    '**/app.module.ts',
    '**/*.module.ts', // Treat all modules as potential entry points to prevent graph breakage
    '**/api/index.ts',
    // Serverless/Lambda entry points (invoked by runtime, not imported by other code)
    '**/*lambda*/**/{index,handler}.{ts,js}',
    '**/*function*/**/{index,handler}.{ts,js}',
    // Storybook stories (entry points for Storybook)
    '**/*.stories.{ts,tsx,js,jsx}',
    // Test setup files
    '**/jest.setup.{ts,js}',
    '**/vitest.setup.{ts,js}',
    '**/setup-tests.{ts,js}',
    // Database seeds
    '**/seed.{ts,js}',
    '**/seeds/**/*.{ts,js}',
    // Prisma schema and generated
    '**/prisma/**/*.{ts,js}',
  ];

  // If the search directory itself is a Lambda/serverless app, add root entry patterns
  const searchDirName = searchDir.toLowerCase();
  if (searchDirName.includes('lambda') || searchDirName.includes('function') || searchDirName.includes('serverless')) {
    entryPatterns.push('{index,handler}.{ts,js}');
  }

  // Expo / React Native: file-based routing uses _layout.tsx and every file in app/ is a route
  const frameworks = detectAppFramework(searchDir);
  const isExpoOrRN = frameworks.includes('expo') || frameworks.includes('react-native');
  if (isExpoOrRN) {
    entryPatterns.push(
      '**/_layout.{ts,tsx,js,jsx}',       // Expo Router layouts (underscore prefix)
      'app/**/*.{ts,tsx,js,jsx}',          // All files in app/ are Expo Router routes
      'App.{ts,tsx,js,jsx}',               // Classic RN entry point
      'index.{ts,tsx,js,jsx}',             // RN entry point
      'app.{json,config.js,config.ts}',    // Expo config files
      'metro.config.{js,ts,cjs}',          // Metro bundler config
      'babel.config.{js,cjs}',             // Babel config
      'expo-env.d.ts',                     // Expo type declarations
      'eas.json',                          // EAS Build config
    );
  }

  for (const file of allFiles) {
    const relPath = relative(searchDir, file);
    const isEntry = entryPatterns.some(pattern => {
       return minimatch(relPath, pattern, { dot: true });
    });

    if (isEntry) entryFiles.add(file);
  }

  // 3. Parse tsconfig.json paths for alias resolution
  const aliasMap = parseTsConfigPaths(searchDir);

  if (process.env.DEBUG_PRUNY && aliasMap.size > 0) {
    console.log(`[DEBUG] Loaded ${aliasMap.size} path aliases from tsconfig.json`);
    for (const [prefix, targets] of aliasMap) {
      console.log(`[DEBUG]   ${prefix}* → ${targets.join(', ')}`);
    }
  }

  // 4. Track usage by resolving imports
  const usedFiles = new Set<string>(entryFiles);
  const queue = Array.from(entryFiles);
  const visited = new Set<string>(entryFiles);

  // Enhanced regex to handle newlines and various import styles
  const importRegex = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g;

  while (queue.length > 0) {
    const currentFile = queue.shift()!;
    const currentDir = dirname(currentFile);

    try {
      const content = readFileSync(currentFile, 'utf-8');

      let match;
      importRegex.lastIndex = 0;

      while ((match = importRegex.exec(content)) !== null) {
        const imp = match[1] || match[2] || match[3];
        if (!imp) continue;

        let resolvedFile: string | null = null;

        if (imp.startsWith('.')) {
          // Resolve relative to current file
          resolvedFile = resolveImportAbsolute(currentDir, imp, extensions);
        } else {
          // Try tsconfig path aliases first
          for (const [prefix, targets] of aliasMap) {
            if (imp.startsWith(prefix)) {
              const remainder = imp.substring(prefix.length);
              for (const target of targets) {
                resolvedFile = resolveImportAbsolute(target, remainder, extensions);
                if (resolvedFile) break;
              }
              if (resolvedFile) break;
            }
          }

          // Fallback: hardcoded @/ and ~/ for projects without tsconfig paths
          if (!resolvedFile && (imp.startsWith('@/') || imp.startsWith('~/'))) {
            const aliasPath = imp.substring(2);
            resolvedFile = resolveImportAbsolute(searchDir, aliasPath, extensions) ||
                           resolveImportAbsolute(join(searchDir, 'src'), aliasPath, extensions);
          }
        }

        if (resolvedFile && allFilesSet.has(resolvedFile) && !visited.has(resolvedFile)) {
             usedFiles.add(resolvedFile);
             visited.add(resolvedFile);
             queue.push(resolvedFile);
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  const files: UnusedFile[] = allFiles
    .filter(f => !usedFiles.has(f))
    .map(f => {
      const s = statSync(f);
      return {
        path: relative(config.dir, f),
        size: s.size,
      };
    });

  return {
    total: allFiles.length,
    used: usedFiles.size,
    unused: files.length,
    files
  };
}

/**
 * Resolve an import path to an absolute path
 */
function resolveImportAbsolute(baseDir: string, impPath: string, extensions: string[]): string | null {
  const target = resolve(baseDir, impPath);
  
  // 1. Exact match (Priority: maybe imports file with extension)
  if (existsSync(target) && statSync(target).isFile()) return target;

  // 2. Direct file with extensions
  for (const ext of extensions) {
    const file = target + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }

  // 3. Directory index
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const ext of extensions) {
      const index = join(target, 'index' + ext);
      if (existsSync(index) && statSync(index).isFile()) return index;
    }
  }

  return null;
}
