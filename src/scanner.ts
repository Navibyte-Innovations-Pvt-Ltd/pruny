import fg from 'fast-glob';
import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import { join } from 'node:path';
import {
  extractApiReferences,
  EXPORTED_METHOD_PATTERN,
  NEST_CONTROLLER_PATTERN,
  NEST_METHOD_PATTERN,
  type ApiReference
} from './patterns.js';
import type { Config, ApiRoute, ScanResult, VercelConfig } from './types.js';
import { minimatch } from 'minimatch';
import { scanPublicAssets } from './scanners/public-assets.js';
import { scanUnusedFiles } from './scanners/unused-files.js';
import { scanUnusedExports } from './scanners/unused-exports.js';
import { scanHttpUsage } from './scanners/http-usage.js';
import { scanSourceAssets } from './scanners/source-assets.js';
import { scanMissingAssets } from './scanners/missing-assets.js';
import { scanUnusedServices } from './scanners/unused-services.js';
import { scanBrokenLinks } from './scanners/broken-links.js';

export { scanUnusedExports, scanUnusedFiles, scanHttpUsage, scanSourceAssets, scanMissingAssets, scanUnusedServices, scanBrokenLinks };

/**
 * Extract route path from file path
 * Supports:
 * - Single Repo: app/api/users/route.ts -> /api/users
 * - Monorepo: apps/web/app/api/users/route.ts -> /api/users (normalized)
 */
function extractRoutePath(filePath: string): string {
  // 1. Remove standard prefixes
  let path = filePath
    .replace(/^src\//, '')
    .replace(/^apps\/[^/]+\//, '') // Remove apps/<app-name>/
    .replace(/^packages\/[^/]+\//, ''); // Remove packages/<pkg-name>/

  // 2. Remove app/ prefix
  path = path.replace(/^app\//, '');

  // 3. Remove route suffix
  path = path.replace(/\/route\.(ts|tsx|js|jsx)$/, '');

  return '/' + path;
}

/**
 * Extract Next.js exported HTTP methods and their line numbers
 */
function extractExportedMethods(content: string): { methods: string[]; methodLines: { [method: string]: number } } {
  const methods: string[] = [];
  const methodLines: { [method: string]: number } = {};
  
  let match;
  EXPORTED_METHOD_PATTERN.lastIndex = 0;
  while ((match = EXPORTED_METHOD_PATTERN.exec(content)) !== null) {
    if (match[1]) {
      const methodName = match[1];
      methods.push(methodName);
      
      // Calculate line number
      const pos = match.index;
      const lineNum = content.substring(0, pos).split('\n').length;
      methodLines[methodName] = lineNum;
    }
  }
  return { methods, methodLines };
}

/**
 * Extract NestJS Controller Routes
 */
function extractNestRoutes(filePath: string, content: string, globalPrefix = 'api'): ApiRoute[] {
  // 1. Find Controller Decorator
  const controllerMatch = content.match(NEST_CONTROLLER_PATTERN);
  if (!controllerMatch) return [];

  const controllerPath = controllerMatch[1] || ''; // Empty string if @Controller()
  const routes: ApiRoute[] = [];

  // 2. Find Method Decorators
  NEST_METHOD_PATTERN.lastIndex = 0;
  let methodMatch;
  while ((methodMatch = NEST_METHOD_PATTERN.exec(content)) !== null) {
    // methodMatch[1] = 'Get', 'Post', etc.
    // methodMatch[2] = 'profile' (path)
    const methodType = methodMatch[1].toUpperCase();
    const methodPath = methodMatch[2] || '';
    
    // Calculate line number for NestJS methods too
    const pos = methodMatch.index;
    const lineNum = content.substring(0, pos).split('\n').length;

    // Extract valid TypeScript method name (e.g., update)
    const remainingContent = content.substring(methodMatch.index + methodMatch[0].length);
    const tsMethodName = extractNestMethodName(remainingContent);

    // Construct full path: /<globalPrefix>/<controller>/<method>
    const fullPath = `/${globalPrefix}/${controllerPath}/${methodPath}`
      .replace(/\/+/g, '/') // Dedupe slashes
      .replace(/\/$/, '');  // Remove trailing slash

    // Check if route already exists for this path (handled different methods on same path)
    const existing = routes.find(r => r.path === fullPath);
    if (existing) {
      if (!existing.methods.includes(methodType)) {
        existing.methods.push(methodType);
        existing.unusedMethods.push(methodType);
        existing.methodLines[methodType] = lineNum;
        if (existing.methodNames) {
           existing.methodNames[methodType] = tsMethodName;
        } else {
           existing.methodNames = { [methodType]: tsMethodName };
        }
      }
    } else {
      routes.push({
        type: 'nestjs',
        path: fullPath,
        filePath,
        used: false,
        references: [],
        methods: [methodType],
        unusedMethods: [methodType],
        methodLines: { [methodType]: lineNum },
        methodNames: { [methodType]: tsMethodName },
      });
    }

    if (process.env.DEBUG_PRUNY) {
      console.log(`[DEBUG] Extracted Route: ${fullPath} from ${filePath}`);
    }
  }

  return routes;
}


/**
 * Extract the method name following a decorator match
 */
function extractNestMethodName(content: string): string {
  // Remove comments to avoid false positives
  const cleanContent = content
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Look for the method signature
  // Matches: async? name(
  // Skips decorators (@Deco) by treating them as whitespace/preamble effectively
  // But we need to be careful about @Deco(func()) calls inside decorators
  // However, most decorators take objects or strings.
  
  // We scan for explicitly method-looking patterns.
  // Standard NestJS/TS method:
  // [decorators]
  // [accessibility] [async] name(
  
  // We can just look for the first identifier followed by ( that is NOT a keyword
  // and is NOT preceded by 'new '
  
  // Regex explanation:
  // 1. Skip potential decorators lines: (@\w+(\(.*\))?\s*)*
  // 2. Skip modifiers: (public|private|protected|async|...)*
  // 3. Capture name: (\w+)
  // 4. Expect: \(
  
  // Checking for first occurrence of "identifier (" often works if we skip keywords.
   const methodRegex = /^(?:public|private|protected|static|async|readonly|function|const|let|var)?\s*(?:async)?\s*([a-zA-Z0-9_$]+)\s*\(/;
  
  const lines = cleanContent.split('\n');
  let parenDepth = 0;
  
  for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;
      
      // If we are currently inside a decorator's parentheses, wait until they close
      if (parenDepth > 0) {
          const opens = (line.match(/\(/g) || []).length;
          const closes = (line.match(/\)/g) || []).length;
          parenDepth += opens - closes;
          continue;
      }
      
      if (line.startsWith('@')) {
          // It's a decorator. Check if it has an opening paren on the same line
          const opens = (line.match(/\(/g) || []).length;
          const closes = (line.match(/\)/g) || []).length;
          parenDepth = opens - closes;
          continue;
      }
      
      // Not a decorator and not inside one. Check if it's a method/var declaration
      const match = line.match(methodRegex);
      if (match) {
          const name = match[1];
          if (!['if', 'switch', 'for', 'while', 'catch', 'function', 'constructor', 'Param', 'Body', 'Headers', 'Req', 'Res', 'Query', 'UploadedFile'].includes(name)) {
              return name;
          }
      }
  }
  return '';
}

/**
 * Check if a path matches any ignore pattern
 */
export function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const cleanPath = path.replace(/\\/g, '/').replace(/^\//, '').replace(/^\.\//, '');

  return ignorePatterns.some((pattern) => {
    let cleanPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    const isAbsolute = cleanPattern.startsWith('/');
    if (isAbsolute) cleanPattern = cleanPattern.substring(1);

    // 1. Exact or glob match
    if (minimatch(cleanPath, cleanPattern)) return true;

    // 2. Folder check
    const folderPattern = cleanPattern.endsWith('/') ? cleanPattern : cleanPattern + '/';
    if (cleanPath.startsWith(folderPattern)) return true;

    // 3. Suffix match for simple segments (tags)
    if (!isAbsolute && !cleanPattern.includes('/') && !cleanPattern.includes('*')) {
      if (cleanPath.endsWith('/' + cleanPattern) || cleanPath === cleanPattern) return true;
    }

    return false;
  });
}

/**
 * Normalize Next.js API path for comparison (e.g. /api/users/[id] -> /api/users/*)
 */
function normalizeNextPath(path: string): string {
  return path
    .replace(/\/$/, '')
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/\[[^\]]+\]/g, '*')
    .toLowerCase();
}

/**
 * Normalize NestJS API path for comparison (e.g. /api/users/:id -> /api/users/*)
 */
function normalizeNestPath(path: string): string {
  return path
    .replace(/\/$/, '')
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/:[^/]+/g, '*')
    .toLowerCase();
}

/**
 * Detect Global Prefix from NestJS main.ts
 */
async function detectGlobalPrefix(appDir: string): Promise<string> {
  const mainTsPath = join(appDir, 'src/main.ts');
  const mainTsAltPath = join(appDir, 'main.ts');

  let content: string;
  if (existsSync(mainTsPath)) {
    content = readFileSync(mainTsPath, 'utf-8');
  } else if (existsSync(mainTsAltPath)) {
    content = readFileSync(mainTsAltPath, 'utf-8');
  } else {
    return '';
  }

  // Look for app.setGlobalPrefix('...')
  const match = content.match(/app\.setGlobalPrefix\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (match && match[1]) {
    console.log(chalk.dim(`   ⚙ Global prefix: /${match[1]}`));
    return match[1];
  }
  
  return '';
}

/**
 * Check if a route is referenced and which methods are used
 */
function checkRouteUsage(route: ApiRoute, references: ApiReference[], nestGlobalPrefix = ''): { used: boolean; usedMethods: Set<string> } {
  const normalize = route.type === 'nextjs' ? normalizeNextPath : normalizeNestPath;
  const normalizedRoute = normalize(route.path);
  
  // Potential variations of the route path for matching
  const variations = new Set<string>([normalizedRoute]);

  if (route.type === 'nestjs') {
    // 1. If it has a prefix, try without it
    if (nestGlobalPrefix) {
      const prefixToRemove = `/${nestGlobalPrefix}`.replace(/\/+/g, '/');
      if (route.path.startsWith(prefixToRemove)) {
        variations.add(normalize(route.path.substring(prefixToRemove.length)));
      }
    }
    
    // 2. Try adding/removing /api explicitly as it's the most common convention
    if (route.path.startsWith('/api/')) {
      variations.add(normalize(route.path.substring(4)));
    } else {
      variations.add(normalize('/api' + route.path));
    }
  }

  const usedMethods = new Set<string>();
  let used = false;


  for (const ref of references) {
    let normalizedFound = ref.path
      .replace(/\s+/g, '') // Collapse all whitespace (newlines, tabs, spaces from multiline template literals)
      .replace(/\$\{[^}]+\}/g, '*') // Replace template expressions BEFORE query strip (?.user.id would be eaten by \?.*$)
      .replace(/\/$/, '')
      .replace(/\?.*$/, '')
      .replace(/\/+/g, '/') // Dedupe slashes
      .toLowerCase();
    
    // If it starts with *, it likely had a base URL variable: `${baseUrl}/api/...` -> `*/api/...`
    // We want to match against the static part, so we can try stripping the leading *
    if (normalizedFound.startsWith('*')) {
      const firstSlash = normalizedFound.indexOf('/');
      if (firstSlash !== -1) {
        normalizedFound = normalizedFound.substring(firstSlash);
      }
    }


    let match = false;
    for (const v of variations) {
      if (v === normalizedFound || 
          normalizedFound.startsWith(v + '/') ||
          minimatch(normalizedFound, v)) {
        match = true;
        break;
      }
    }

    if (match) {
      used = true;
      if (ref.method) {
        usedMethods.add(ref.method);
      } else {
        usedMethods.add('ALL');
      }
    }
  }


  return { used, usedMethods };
}

/**
 * Load vercel.json and get externally-invoked paths (crons + rewrite/redirect targets)
 */
function getVercelExternalPaths(dir: string): string[] {
  const vercelPath = join(dir, 'vercel.json');

  if (!existsSync(vercelPath)) {
    return [];
  }

  try {
    const content = readFileSync(vercelPath, 'utf-8');
    const config: VercelConfig = JSON.parse(content);
    const paths: string[] = [];

    // Cron paths
    if (config.crons) {
      paths.push(...config.crons.map((cron: { path: string }) => cron.path));
    }

    // Rewrite destinations that point to API routes
    if (config.rewrites) {
      for (const rw of config.rewrites) {
        if (rw.destination?.startsWith('/api/')) {
          paths.push(rw.destination);
        }
      }
    }

    // Redirect sources/destinations that point to API routes
    if (config.redirects) {
      for (const rd of config.redirects) {
        if (rd.source?.startsWith('/api/')) paths.push(rd.source);
        if (rd.destination?.startsWith('/api/')) paths.push(rd.destination);
      }
    }

    return paths;
  } catch {
    return [];
  }
}

/**
 * Auto-detect routes that are externally invoked based on project dependencies
 */
function getAutoDetectedExternalRoutes(dir: string): string[] {
  const routes: string[] = [];

  // Check package.json for known libraries that create external routes
  const packagePaths = [
    join(dir, 'package.json'),
  ];

  for (const pkgPath of packagePaths) {
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Auth.js / NextAuth creates /api/auth/[...nextauth]
      if (allDeps['next-auth'] || allDeps['@auth/nextjs'] || allDeps['@auth/core']) {
        routes.push('/api/auth/**');
      }

      // Inngest creates /api/inngest
      if (allDeps['inngest']) {
        routes.push('/api/inngest');
      }
    } catch {
      // Ignore parse errors
    }
  }

  return routes;
}

export async function scan(config: Config): Promise<ScanResult> {
  const cwd = config.dir;

  // 1. Find Next.js Routes
  const nextPatterns = [
    // Standard patterns
    'app/api/**/route.{ts,tsx,js,jsx}',
    'src/app/api/**/route.{ts,tsx,js,jsx}',
    'apps/**/app/api/**/route.{ts,tsx,js,jsx}',
    'packages/**/app/api/**/route.{ts,tsx,js,jsx}',
  ];

  // If appSpecificScan is set, OVERRIDE patterns to only look inside that app
  let scanCwd = cwd;
  let activeNextPatterns = nextPatterns;

  if (config.appSpecificScan) {
      scanCwd = config.appSpecificScan.appDir;
      activeNextPatterns = [
          'app/api/**/route.{ts,tsx,js,jsx}',
          'src/app/api/**/route.{ts,tsx,js,jsx}',
      ];
  }

  // Add extra patterns from config
  if (config.extraRoutePatterns) {
    activeNextPatterns.push(...config.extraRoutePatterns);
  }

  // 1. Detect Global Prefix (for NestJS)
  let detectedGlobalPrefix = config.nestGlobalPrefix || ''; 
  if (!config.nestGlobalPrefix) {
     const prefix = await detectGlobalPrefix(scanCwd);
     if (prefix) detectedGlobalPrefix = prefix;
  }

  const nextFiles = await fg(activeNextPatterns, {
    cwd: scanCwd,
    ignore: config.ignore.folders,
  });

  const nextRoutes: ApiRoute[] = nextFiles.map((file) => {
    // If scanning in appDir specific context, we need to map back relative to root if needed, 
    // but here we just need a unique path identification.
    // The existing extractRoutePath handles simple relative paths well.
    const fullPath = join(scanCwd, file);
    const content = readFileSync(fullPath, 'utf-8');
    const { methods, methodLines } = extractExportedMethods(content);
    return {
      type: 'nextjs',
      path: extractRoutePath(file), // This extracts /api/xyz
      filePath: fullPath.replace(config.appSpecificScan ? config.appSpecificScan.rootDir + '/' : cwd + '/', ''), // Store relative path from ROOT
      used: false,
      references: [],
      methods,
      unusedMethods: [...methods],
      methodLines,
    };
  });

  // 2. Find NestJS Controllers
  const nestPatterns = ['**/*.controller.ts'];
  const nestFiles = await fg(nestPatterns, {
    cwd: scanCwd, // Use the context-aware CWD
    ignore: config.ignore.folders,
  });

  const nestRoutes: ApiRoute[] = nestFiles.flatMap((file) => {
    const fullPath = join(scanCwd, file);
    const content = readFileSync(fullPath, 'utf-8');
    const relativePathFromRoot = fullPath.replace(config.appSpecificScan ? config.appSpecificScan.rootDir + '/' : cwd + '/', '');
    
    // When inside a specific app scan, we might want to respect that app's prefix if we could detect it,
    // but for now we rely on the global config prefix.
    return extractNestRoutes(relativePathFromRoot, content, detectedGlobalPrefix);
  });

  // Combine Routes
  let routes = [...nextRoutes, ...nestRoutes];

  // 2.5 Filter by folder if specified
  if (config.folder) {
      const folderFilter = config.folder.replace(/\\/g, '/');
      routes = routes.filter(r => r.filePath.includes(folderFilter));
  }

  // 3. Mark vercel external routes as used
  const vercelPaths = getVercelExternalPaths(cwd);
  for (const extPath of vercelPaths) {
    const route = routes.find((r) => r.path === extPath);
    if (route) {
      route.used = true;
      route.references.push('vercel.json');
      route.unusedMethods = [];
    }
  }

  // 3.5 Mark auto-detected external routes as used (next-auth, inngest, etc.)
  const autoDetectedPaths = getAutoDetectedExternalRoutes(
    config.appSpecificScan ? config.appSpecificScan.appDir : cwd
  );
  for (const extPath of autoDetectedPaths) {
    for (const route of routes) {
      if (route.used) continue;
      if (minimatch(route.path, extPath) || route.path === extPath) {
        route.used = true;
        route.references.push('(auto-detected external)');
        route.unusedMethods = [];
      }
    }
  }

  // 4. Find all source files to scan (ALWAYS SCAN ROOT FOR REFERENCES)
  // Even if we are scanning just one app's routes, we must check if other apps/packages call them.
  const referenceScanCwd = config.appSpecificScan ? config.appSpecificScan.rootDir : cwd;
  
  const extGlob = `**/*{${config.extensions.join(',')}}`;
  const sourceFiles = await fg(extGlob, {
    cwd: referenceScanCwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

  // 5. Collect all API references
  const allReferences: ApiReference[] = [];
  const fileReferences: Map<string, ApiReference[]> = new Map();

  for (const file of sourceFiles) {
    const filePath = join(referenceScanCwd, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const refs = extractApiReferences(content);

      if (refs.length > 0) {
        // file is relative to referenceScanCwd (Root)
        fileReferences.set(file, refs);
        allReferences.push(...refs);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // 6. Mark routes as used
  for (const route of routes) {
    // Skip ignored routes (check both API path and source file path)
    if (shouldIgnore(route.path, config.ignore.routes) || shouldIgnore(route.filePath, config.ignore.routes)) {
      route.used = true;
      route.references.push('(ignored by config)');
      route.unusedMethods = [];
      continue;
    }

    // Check references
    const { used, usedMethods } = checkRouteUsage(route, allReferences, detectedGlobalPrefix);

    if (used) {
      route.used = true;

      // Update unused methods
      if (usedMethods.has('ALL')) {
        route.unusedMethods = [];
      } else {
        const unused = route.methods.filter(m => !usedMethods.has(m));
        
        // CRITICAL FIX: To prevent false positive deletion when path matches but method doesn't
        // (e.g. backend GET /refresh called via axios.post), we avoid marking ALL methods as unused
        // if the path itself is being called somewhere in the app.
        if (unused.length === route.methods.length && route.methods.length > 0) {
            // Keep the first method as "used" to avoid breaking the endpoint
            route.unusedMethods = route.methods.slice(1);
        } else {
            route.unusedMethods = unused;
        }
      }

      // Find which files reference this route
      for (const [file, refs] of fileReferences) {
        if (checkRouteUsage(route, refs, detectedGlobalPrefix).used) {
          route.references.push(file);
        }
      }
    }
  }

  // 7. Scan public assets (if not excluded)
  let publicAssets;
  if (!config.excludePublic) {
    publicAssets = await scanPublicAssets(config);
  }

  // 8. Scan for unused files
  const unusedFiles = await scanUnusedFiles(config);



  return {
    total: routes.length,
    used: routes.filter((r) => r.used).length,
    unused: routes.filter((r) => !r.used).length,
    routes,
    publicAssets,
    missingAssets: await scanMissingAssets(config),
    brokenLinks: await scanBrokenLinks(config),
    unusedFiles,
    unusedExports: await scanUnusedExports(config).then(result => {
      // Filter out controller file exports — these are route handlers, not standard exports.
      // Controller methods are never imported by other files; they're called via HTTP by NestJS.
      // The route scanner (above) is the correct tool for analyzing controller method usage.
      const filtered = result.exports.filter(exp =>
        !exp.file.endsWith('.controller.ts') && !exp.file.endsWith('.controller.tsx')
      );
      return { ...result, exports: filtered, unused: filtered.length };
    }),
    unusedServices: await scanUnusedServices(config),
    httpUsage: await scanHttpUsage(config),
  };
}
