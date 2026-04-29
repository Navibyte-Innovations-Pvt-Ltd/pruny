import fg from 'fast-glob';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { minimatch } from 'minimatch';
import type { Config } from '../types.js';
import { detectAppFramework, parseTsConfigPaths } from '../utils.js';

export interface BrokenLink {
  path: string;          // e.g. '/signup'
  references: string[];  // e.g. ['src/components/navbar.tsx:14']
}

export interface BrokenLinksResult {
  total: number;
  scanned: number;       // total unique internal link paths found
  links: BrokenLink[];
}

/**
 * Regex patterns to extract internal route references from source files.
 *
 * Both plain string literals AND template literals are captured. For template
 * literals (paths that embed `${...}`), `normalizePath` later replaces each
 * expression with `[id]` so the value becomes a dynamic-route reference we
 * can validate against Next.js's `app/.../[id]/page.tsx` layout.
 */
const LINK_PATTERNS: RegExp[] = [
  // <Link href="/path"> | <Link href='/path'> | <Link href={`/path/${id}`}>
  /<Link\s+[^>]*href\s*=\s*(?:\{\s*)?['"`](\/[^'"`\s]+)['"`](?:\s*\})?/g,

  // router.push("/path") / router.replace("/path") / router.push(`/path/${id}`)
  /router\.(push|replace)\s*\(\s*['"`](\/[^'"`\s]+)['"`]/g,

  // redirect("/path") / permanentRedirect("/path")
  /(?:redirect|permanentRedirect)\s*\(\s*['"`](\/[^'"`\s]+)['"`]/g,

  // href: "/path" (navigation config objects)
  /href\s*:\s*['"`](\/[^'"`\s]+)['"`]/g,

  // <a href="/path"> (plain HTML)
  /<a\s+[^>]*href\s*=\s*(?:\{\s*)?['"`](\/[^'"`\s]+)['"`](?:\s*\})?/g,

  // revalidatePath("/path")
  /revalidatePath\s*\(\s*['"`](\/[^'"`\s]+)['"`]/g,

  // pathname === "/path" or pathname === '/path' (usePathname comparisons)
  /pathname\s*===?\s*['"`](\/[^'"`\s]+)['"`]/g,
];

/**
 * Extract the captured path from a regex match.
 * Some patterns have the path in group 1, others in group 2 (router patterns).
 */
function extractPath(match: RegExpExecArray): string | null {
  // router.(push|replace) has method in group 1, path in group 2
  if (match[2] && match[2].startsWith('/')) return match[2];
  if (match[1] && match[1].startsWith('/')) return match[1];
  return null;
}

/**
 * Normalize a captured path so template-literal placeholders become `[id]`
 * segments that match Next.js dynamic route files. Anything inside `${...}` —
 * including complex expressions or nested braces — collapses to `[id]`.
 *
 * Examples:
 *   /dashboard/compliance/${id}                  -> /dashboard/compliance/[id]
 *   /firm/${slug}/onboarding/${token}            -> /firm/[id]/onboarding/[id]
 *   /foo/${ getId() }/bar                        -> /foo/[id]/bar
 */
function normalizePath(raw: string): string {
  // Replace `${...}` with [id]. Non-greedy, single-level braces (enough for
  // typical expressions; `${` nesting is rare in href interpolations).
  let out = raw.replace(/\$\{[^}]*\}/g, '[id]');
  // Drop any stray braces that survived (e.g. unmatched closing).
  out = out.replace(/[{}]/g, '');
  return out;
}

/**
 * Check if a path should be skipped from broken link detection.
 */
function shouldSkipPath(path: string): boolean {
  // External links (shouldn't match our regex, but just in case)
  if (/^https?:\/\//.test(path)) return true;
  if (/^mailto:/.test(path)) return true;
  if (/^tel:/.test(path)) return true;

  // Hash-only links
  if (path === '#' || path.startsWith('#')) return true;

  // API routes (covered by existing scanner)
  if (path.startsWith('/api/') || path === '/api') return true;

  // Next.js internal paths
  if (path === '/_next' || path.startsWith('/_next/')) return true;

  return false;
}

/**
 * Strip query params and hash fragments from a path.
 * /about?ref=home#team -> /about
 */
function cleanPath(path: string): string {
  return path.replace(/[?#].*$/, '').replace(/\/$/, '') || '/';
}

/**
 * Convert a Next.js file-system route to a URL path.
 * Handles route groups, parallel routes, and intercepted routes.
 *
 * app/(marketing)/pricing/page.tsx -> /pricing
 * app/dashboard/[id]/page.tsx -> /dashboard/[id]
 * app/@modal/photo/page.tsx -> /photo
 * app/(.)photo/page.tsx -> stripped (intercepted routes)
 */
function filePathToRoute(filePath: string): string {
  let path = filePath
    // Remove common prefixes
    .replace(/^src\//, '')
    .replace(/^apps\/[^/]+\//, '')
    .replace(/^packages\/[^/]+\//, '');

  // Remove app/ or pages/ prefix
  path = path.replace(/^app\//, '').replace(/^pages\//, '');

  // Remove page file suffix
  path = path.replace(/\/page\.(ts|tsx|js|jsx|md|mdx)$/, '');
  // Pages router: remove file extension
  path = path.replace(/\.(ts|tsx|js|jsx)$/, '');
  // Pages router: remove /index
  path = path.replace(/\/index$/, '');

  // Split into segments and filter special ones
  const segments = path.split('/').filter(segment => {
    // Route groups: (marketing), (auth) — transparent, strip them
    if (/^\([^.)][^)]*\)$/.test(segment)) return false;

    // Parallel routes: @modal, @sidebar — transparent, strip them
    if (segment.startsWith('@')) return false;

    // Intercepted routes: (.), (..), (...) — strip them
    if (/^\(\.+\)/.test(segment)) return false;

    return true;
  });

  return '/' + segments.join('/');
}

/**
 * Per-route resolved static params.
 * Maps dynamic param name (e.g. "slug") to a Set of valid concrete values.
 * Only present when `generateStaticParams` could be statically resolved.
 */
export type ResolvedParams = Record<string, Set<string>>;

export interface DynamicRouteInfo {
  segments: string[];
  /**
   * Set when `generateStaticParams` was found AND fully statically resolvable.
   * If absent, we keep the legacy permissive behavior (any value matches the
   * dynamic segment) to avoid false positives.
   */
  params?: ResolvedParams;
}

/**
 * Check if a referenced path matches any known route.
 * Handles dynamic segments [slug] and catch-all [...slug].
 * Also handles multi-tenant/subdomain routing where links like /view_seat
 * resolve under dynamic parent routes like /tenant/[domain]/view_seat.
 */
function matchesRoute(refPath: string, routes: Set<string>, routes_: DynamicRouteInfo[]): boolean {
  const cleaned = cleanPath(refPath);

  // Exact match
  if (routes.has(cleaned)) return true;

  // Check against dynamic routes
  const refSegments = cleaned.split('/').filter(Boolean);

  for (const route of routes_) {
    if (matchSegments(refSegments, route.segments, route.params)) return true;

    // Multi-tenant/subdomain routing: a link like /view_seat may resolve to
    // /tenant_sites/[domain]/view_seat at runtime via middleware/subdomain routing.
    // Check if the link path matches the tail of a dynamic route.
    if (matchesDynamicSuffix(refSegments, route.segments)) return true;
  }

  return false;
}

/**
 * Check if refSegments match the tail of a route whose skipped prefix
 * consists only of static segments and dynamic segments (e.g., tenant/[domain]).
 * This handles multi-tenant subdomain routing where /view_seat is actually
 * /tenant_sites/[domain]/view_seat in the file system.
 *
 * The tail (matched portion) must contain at least one literal (non-dynamic)
 * segment to avoid false matches. Without this guard, a route like
 * /firm/[slug]/onboarding/[token] would match ANY single-segment link
 * (e.g., /for-chartered-accountants-2) via the dynamic [token] tail.
 */
function matchesDynamicSuffix(refSegments: string[], routeSegments: string[]): boolean {
  if (refSegments.length >= routeSegments.length) return false;

  // The prefix we'd skip must contain at least one dynamic segment
  const prefixLen = routeSegments.length - refSegments.length;
  const prefix = routeSegments.slice(0, prefixLen);

  if (!prefix.some(s => /^\[.+\]$/.test(s))) return false;

  // The tail must contain at least one literal segment to be a meaningful match.
  // A fully-dynamic tail (e.g., [token]) would match any path, creating false positives.
  const tail = routeSegments.slice(prefixLen);
  const hasLiteralInTail = tail.some(s => !/^\[/.test(s));
  if (!hasLiteralInTail) return false;

  return matchSegments(refSegments, tail);
}

/**
 * Match path segments against route segments with dynamic/catch-all support.
 *
 * When `params` is provided (static-params constraint resolved from
 * `generateStaticParams`), a dynamic segment `[name]` only matches when the
 * concrete value at that position is included in `params[name]`. If `params`
 * is absent, dynamic segments accept any value (legacy behavior).
 */
function matchSegments(
  refSegments: string[],
  routeSegments: string[],
  params?: ResolvedParams,
): boolean {
  let ri = 0;
  let si = 0;

  while (ri < refSegments.length && si < routeSegments.length) {
    const routeSeg = routeSegments[si];

    // Catch-all: [...slug] or [[...slug]] — matches rest of path
    if (/^\[\[?\.\.\./.test(routeSeg)) return true;

    // Dynamic segment: [id] — matches any single segment
    const dynMatch = /^\[(.+)\]$/.exec(routeSeg);
    if (dynMatch) {
      const paramName = dynMatch[1];
      if (params && params[paramName]) {
        // Constrain match to known static values (case-insensitive).
        const ref = refSegments[ri];
        const allowed = params[paramName];
        let ok = false;
        for (const v of allowed) {
          if (v.toLowerCase() === ref.toLowerCase()) { ok = true; break; }
        }
        if (!ok) return false;
      }
      ri++;
      si++;
      continue;
    }

    // Literal match
    if (refSegments[ri].toLowerCase() !== routeSeg.toLowerCase()) return false;

    ri++;
    si++;
  }

  return ri === refSegments.length && si === routeSegments.length;
}

/**
 * Check if a link path matches a gitignored pattern under public/.
 * Build artifacts like sitemap.xml may be gitignored but exist at runtime.
 * We check .gitignore patterns from both the app dir and repo root.
 */
function isGitignoredPublicFile(appDir: string, linkPath: string): boolean {
  // The file path relative to the project root would be public/sitemap.xml
  const publicRelPath = `public${linkPath}`;

  // Check .gitignore in appDir and parent dirs (monorepo root)
  const dirsToCheck = [appDir];
  const parentDir = join(appDir, '..', '..');
  if (existsSync(join(parentDir, '.gitignore'))) {
    dirsToCheck.push(parentDir);
  }

  for (const dir of dirsToCheck) {
    const gitignorePath = join(dir, '.gitignore');
    if (!existsSync(gitignorePath)) continue;

    try {
      const patterns = readFileSync(gitignorePath, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        // Drop comments, blanks AND negation re-includes (`!pattern`). minimatch
        // treats `!foo` as "match anything NOT foo" which flips the match for
        // every unrelated path and silently ignores broken-link detection.
        .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));

      for (const pattern of patterns) {
        if (minimatch(publicRelPath, pattern, { dot: true }) ||
            minimatch(linkPath.slice(1), pattern, { dot: true }) ||
            minimatch(`**/public${linkPath}`, pattern, { dot: true })) {
          return true;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return false;
}

/**
 * Scan for broken internal links — references to page routes that don't exist.
 */
export async function scanBrokenLinks(config: Config): Promise<BrokenLinksResult> {
  const appDir = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;

  // 1. Build route map from Next.js file-based routing
  const pagePatterns = [
    'app/**/page.{ts,tsx,js,jsx,md,mdx}',
    'src/app/**/page.{ts,tsx,js,jsx,md,mdx}',
    'pages/**/*.{ts,tsx,js,jsx}',
    'src/pages/**/*.{ts,tsx,js,jsx}',
  ];

  const pageFiles = await fg(pagePatterns, {
    cwd: appDir,
    ignore: [...config.ignore.folders, '**/node_modules/**', '**/_*/**'],
  });

  // No pages found — nothing to validate against
  if (pageFiles.length === 0) {
    return { total: 0, scanned: 0, links: [] };
  }

  const knownRoutes = new Set<string>();
  const routeSegmentsList: DynamicRouteInfo[] = [];

  // Always add root route
  knownRoutes.add('/');

  // tsconfig path aliases for resolving `@/...` imports in `generateStaticParams`.
  const aliasMap = parseTsConfigPaths(appDir);

  for (const file of pageFiles) {
    const route = filePathToRoute(file);
    knownRoutes.add(route);

    // Store segments for dynamic matching
    const segments = route.split('/').filter(Boolean);
    if (segments.some(s => s.startsWith('['))) {
      const absFile = join(appDir, file);
      const params = resolveStaticParams(absFile, appDir, aliasMap);
      routeSegmentsList.push({ segments, params: params ?? undefined });

      if (process.env.DEBUG_PRUNY) {
        if (params) {
          const summary = Object.entries(params)
            .map(([k, v]) => `${k}=${v.size}`)
            .join(', ');
          console.log(`[DEBUG] Static params for ${route}: ${summary}`);
        }
      }
    }
  }

  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG] Known routes: ${Array.from(knownRoutes).join(', ')}`);
  }

  // 2. Find all source files to scan for link references
  const refDir = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
  const ignore = [...config.ignore.folders, ...config.ignore.files, '**/node_modules/**'];
  const extensions = config.extensions;
  const globPattern = `**/*{${extensions.join(',')}}`;

  let sourceFiles = await fg(globPattern, {
    cwd: refDir,
    ignore,
    absolute: true,
  });

  // In monorepos, exclude files from Expo/React Native apps — their navigation patterns
  // (e.g., /(tabs)/home, /(auth)/login) are Expo Router routes, not Next.js page links.
  if (config.appSpecificScan) {
    const { readdirSync, lstatSync } = await import('node:fs');
    const { join } = await import('node:path');
    const appsDir = join(config.appSpecificScan.rootDir, 'apps');
    try {
      const apps = readdirSync(appsDir).filter(a => lstatSync(join(appsDir, a)).isDirectory());
      const expoAppDirs: string[] = [];
      for (const app of apps) {
        const appPath = join(appsDir, app);
        const frameworks = detectAppFramework(appPath);
        if (frameworks.includes('expo') || frameworks.includes('react-native')) {
          expoAppDirs.push(appPath);
        }
      }
      if (expoAppDirs.length > 0) {
        sourceFiles = sourceFiles.filter(f => !expoAppDirs.some(d => f.startsWith(d)));
      }
    } catch {
      // Ignore — not a standard monorepo layout
    }
  }

  // 3. Extract link references and check against route map
  const brokenMap = new Map<string, Set<string>>();
  const allLinkPaths = new Set<string>();

  for (const file of sourceFiles) {
    try {
      const content = readFileSync(file, 'utf-8');

      for (const pattern of LINK_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(content)) !== null) {
          const extracted = extractPath(match);
          if (!extracted) continue;
          // Collapse `${...}` placeholders into [id] so template literals can
          // be matched against dynamic Next.js route segments.
          const rawPath = normalizePath(extracted);
          if (shouldSkipPath(rawPath)) continue;

          const cleaned = cleanPath(rawPath);
          if (!cleaned || cleaned === '/') continue;

          allLinkPaths.add(cleaned);

          // Check if route exists
          if (!matchesRoute(cleaned, knownRoutes, routeSegmentsList)) {
            // Check if it's a public static file (e.g., /sitemap.xml, /robots.txt)
            // Works for files that exist locally AND for gitignored build artifacts
            // (e.g., sitemap.xml generated by next-sitemap but gitignored)
            const publicPath = join(appDir, 'public', cleaned);
            if (existsSync(publicPath)) continue;
            if (isGitignoredPublicFile(appDir, cleaned)) continue;

            // Check ignore.links patterns (dedicated), falling back to ignore.routes for compat
            const ignorePatterns = [
              ...(config.ignore.links || []),
              ...config.ignore.routes,
            ];
            const isIgnored = ignorePatterns.some(ignorePath => {
              const pattern = ignorePath.replace(/\*/g, '.*');
              return new RegExp(`^${pattern}$`).test(cleaned);
            });
            if (isIgnored) continue;

            // Calculate line number
            const lineNumber = content.substring(0, match.index).split('\n').length;

            if (!brokenMap.has(cleaned)) {
              brokenMap.set(cleaned, new Set());
            }
            brokenMap.get(cleaned)!.add(`${file}:${lineNumber}`);
          }
        }
      }
    } catch (_e) {
      // Ignore read errors
    }
  }

  // 4. Build result
  const links: BrokenLink[] = [];
  for (const [path, refs] of brokenMap.entries()) {
    links.push({
      path,
      references: Array.from(refs).sort(),
    });
  }

  // Sort by number of references (most referenced first)
  links.sort((a, b) => b.references.length - a.references.length);

  return {
    total: links.length,
    scanned: allLinkPaths.size,
    links,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateStaticParams resolver
// ─────────────────────────────────────────────────────────────────────────────

const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const JSON_EXT = '.json';

/**
 * Resolve `generateStaticParams` for a Next.js dynamic route page file.
 * Returns a map of param-name -> Set of valid concrete values, OR null when
 * the function is missing, dynamic (DB/network), or otherwise unresolvable.
 *
 * Returning null is the safe default — callers fall back to legacy permissive
 * matching, so an unresolvable `generateStaticParams` never produces a false
 * positive.
 */
export function resolveStaticParams(
  routeFile: string,
  appDir: string,
  aliasMap: Map<string, string[]>,
): ResolvedParams | null {
  let content: string;
  try {
    content = readFileSync(routeFile, 'utf-8');
  } catch {
    return null;
  }

  const body = extractFunctionBody(content, 'generateStaticParams');
  if (!body) return null;

  // Find the `return <expr>` (last return wins — usually the only one)
  const returnExpr = extractReturnExpression(body);
  if (!returnExpr) return null;

  return resolveParamsExpression(returnExpr, content, routeFile, appDir, aliasMap, new Set(), 0);
}

/**
 * Extract the body of a function declaration by name.
 * Handles `function NAME`, `async function NAME`, `export function NAME`,
 * `export async function NAME`, plus arrow form `const NAME = () => { ... }`
 * and `export const NAME = async () => { ... }`.
 */
function extractFunctionBody(source: string, name: string): string | null {
  // function declarations
  const fnRe = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`,
    'g',
  );
  let m = fnRe.exec(source);
  if (m) {
    return readBalanced(source, m.index + m[0].length - 1);
  }

  // arrow function: const NAME = (...) => { ... }
  const arrowRe = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`,
    'g',
  );
  m = arrowRe.exec(source);
  if (m) {
    return readBalanced(source, m.index + m[0].length - 1);
  }

  return null;
}

/**
 * Read a brace-balanced block starting at `start` (which points at `{`).
 * Returns the inner content (without the outer braces). String/comment-aware
 * to avoid miscounting braces inside string literals or comments.
 */
function readBalanced(source: string, start: number): string | null {
  if (source[start] !== '{') return null;
  let depth = 0;
  let i = start;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Pull the expression after the final top-level `return` in a function body.
 */
function extractReturnExpression(body: string): string | null {
  // Last return — match `return <stuff until ; or end>`
  const re = /\breturn\s+([\s\S]+?)(?:;|$)/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) last = m;
  if (!last) return null;
  return last[1].trim();
}

/**
 * Resolve a `generateStaticParams` return expression into a {param -> values} map.
 *
 * Supported shapes:
 *   - `[{ slug: "x" }, { slug: "y" }]`          direct array of objects
 *   - `["x","y"].map((slug) => ({ slug }))`      string array → param shorthand
 *   - `IDENT.map(item => ({ slug: item.slug }))` follow IDENT
 *   - `Object.keys(IDENT).map(...)`              follow IDENT, take keys
 *   - `Object.entries(IDENT).map(...)`           same
 */
function resolveParamsExpression(
  expr: string,
  fileContent: string,
  filePath: string,
  appDir: string,
  aliasMap: Map<string, string[]>,
  visited: Set<string>,
  depth: number,
): ResolvedParams | null {
  if (depth > 4) return null;
  expr = expr.trim();

  // Case 1: literal array of objects: [{ slug: "x" }, ...]
  if (expr.startsWith('[')) {
    const arrText = sliceTopLevelArray(expr);
    if (arrText) {
      const tail = expr.slice(arrText.length).trim();

      // [{ id: "x" }, ...]   (no chain)
      if (!tail) {
        const arr = parseObjectArray(arrText);
        if (arr) return mergeParams(arr);
      }

      // [{ id: "x" }, ...].map(...)  or  ["a","b"].map(...)
      if (tail.startsWith('.map')) {
        // Try as string-array first
        const stringArr = parseStringArray(arrText);
        if (stringArr) {
          const paramName = inferParamFromMap(expr) ?? 'slug';
          return { [paramName]: new Set(stringArr) };
        }
        // Fall back: array-of-objects + projection
        const objArr = parseObjectArray(arrText);
        if (objArr) {
          const projection = extractMapProjection(expr);
          if (!projection) return null;
          const out: ResolvedParams = {};
          for (const [param, source] of Object.entries(projection)) {
            const parts = source.split('.');
            parts.shift();
            const values: string[] = [];
            for (const obj of objArr) {
              let v: unknown = obj;
              for (const p of parts) {
                if (v && typeof v === 'object' && p in (v as Record<string, unknown>)) {
                  v = (v as Record<string, unknown>)[p];
                } else { v = undefined; break; }
              }
              if (typeof v === 'string') values.push(v);
            }
            if (values.length > 0) out[param] = new Set(values);
          }
          return Object.keys(out).length > 0 ? out : null;
        }
      }
    }
  }

  // Case 2: Object.keys(IDENT) / Object.entries(IDENT) ... [.map(...)]
  const objKeysM = /^Object\.(keys|entries)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(expr);
  if (objKeysM) {
    const ident = objKeysM[2];
    const keys = resolveIdentifierKeys(ident, fileContent, filePath, appDir, aliasMap, visited, depth);
    if (!keys) return null;
    const paramName = inferParamFromMap(expr) ?? guessFirstParamName(expr) ?? 'slug';
    return { [paramName]: new Set(keys) };
  }

  // Case 3: IDENT.map(...) — IDENT may be array of strings or array of objects
  const identMapM = /^([A-Za-z_$][\w$]*)\s*\.\s*map\s*\(/.exec(expr);
  if (identMapM) {
    const ident = identMapM[1];
    const resolved = resolveIdentifierAsArray(ident, fileContent, filePath, appDir, aliasMap, visited, depth);
    if (!resolved) return null;

    if (resolved.kind === 'strings') {
      const paramName = inferParamFromMap(expr) ?? 'slug';
      return { [paramName]: new Set(resolved.values) };
    }
    if (resolved.kind === 'objects') {
      // Look at projection: map(x => ({ slug: x.foo })) or ({ slug })
      const projection = extractMapProjection(expr);
      if (!projection) return null;
      const out: ResolvedParams = {};
      for (const [param, source] of Object.entries(projection)) {
        const values: string[] = [];
        for (const obj of resolved.values) {
          // source may be "x" (whole item) or "x.foo" (field)
          const parts = source.split('.');
          parts.shift(); // drop iterator name
          let v: unknown = obj;
          for (const p of parts) {
            if (v && typeof v === 'object' && p in (v as Record<string, unknown>)) {
              v = (v as Record<string, unknown>)[p];
            } else {
              v = undefined;
              break;
            }
          }
          if (typeof v === 'string') values.push(v);
        }
        if (values.length > 0) out[param] = new Set(values);
      }
      return Object.keys(out).length > 0 ? out : null;
    }
    if (resolved.kind === 'objectKeys') {
      // IDENT was an object literal; .map called on it makes no runtime sense,
      // but treat keys as available values.
      const paramName = inferParamFromMap(expr) ?? 'slug';
      return { [paramName]: new Set(resolved.values) };
    }
  }

  return null;
}

/** Extract `{ paramName: "iter.path" }` projections from the .map callback. */
function extractMapProjection(expr: string): Record<string, string> | null {
  // Match the .map( ... ) callback body roughly
  const bodyMatch = /\.map\s*\(\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*\(?\s*\{([^}]+)\}/.exec(expr);
  if (!bodyMatch) return null;
  const iter = (bodyMatch[1] ?? bodyMatch[2] ?? '').trim().split(',')[0].trim() || 'item';
  const objBody = bodyMatch[3];

  const out: Record<string, string> = {};
  // Match `key: value` and shorthand `key`
  const propRe = /([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$.]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(objBody)) !== null) {
    const key = m[1];
    const value = m[2] ?? key; // shorthand
    out[key] = value.startsWith(iter + '.') || value === iter ? value : `${iter}.${value}`;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function inferParamFromMap(expr: string): string | null {
  // map(... => ({ slug: ... }))  → 'slug'
  const m = /=>\s*\(?\s*\{\s*([A-Za-z_$][\w$]*)\s*[:}]/.exec(expr);
  return m ? m[1] : null;
}

function guessFirstParamName(expr: string): string | null {
  // If projection has shorthand `({ slug })`
  const m = /\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(expr);
  return m ? m[1] : null;
}

function mergeParams(items: Array<Record<string, string>>): ResolvedParams | null {
  const out: ResolvedParams = {};
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (typeof v !== 'string') continue;
      if (!out[k]) out[k] = new Set();
      out[k].add(v);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse `[{ k: "v", ... }, ...]` literal. Returns null on anything more complex. */
function parseObjectArray(expr: string): Array<Record<string, string>> | null {
  // Strip any trailing chained calls like `.map(...)` — only parse the outer array literal
  const arrText = sliceTopLevelArray(expr);
  if (!arrText) return null;

  const inner = arrText.slice(1, -1).trim();
  if (!inner) return [];

  const items: Array<Record<string, string>> = [];
  // Split by top-level commas between { ... } objects
  let depth = 0;
  let buf = '';
  const chunks: string[] = [];
  let inString: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inString) {
      if (c === '\\') { buf += c + inner[++i]; continue; }
      if (c === inString) inString = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; buf += c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) { chunks.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) chunks.push(buf);

  for (const chunk of chunks) {
    const obj = parseSimpleObject(chunk.trim());
    if (!obj) return null;
    items.push(obj);
  }
  return items;
}

/** Parse `["a", "b", ...]` into a list of strings. Null if any element is not a literal string. */
function parseStringArray(arrText: string): string[] | null {
  if (!arrText.startsWith('[') || !arrText.endsWith(']')) return null;
  const inner = arrText.slice(1, -1).trim();
  if (!inner) return [];
  // Reject if it contains object/array tokens (not a pure string array)
  if (/[{[]/.test(inner)) return null;
  const out: string[] = [];
  const re = /["'`]([^"'`]*)["'`]/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(inner)) !== null) { out.push(m[1]); count++; }
  // Sanity: roughly one literal per comma-separated chunk
  const chunks = inner.split(',').filter(s => s.trim()).length;
  if (count !== chunks) return null;
  return out;
}

/** Slice the source for the top-level `[...]` array literal at the start. */
function sliceTopLevelArray(expr: string): string | null {
  if (expr[0] !== '[') return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return expr.slice(0, i + 1);
    }
  }
  return null;
}

/** Parse `{ k: "v", k2: "v2" }` with string values. Null on failure. */
function parseSimpleObject(text: string): Record<string, string> | null {
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  const body = text.slice(1, -1);
  const out: Record<string, string> = {};
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
    count++;
  }
  return count > 0 ? out : null;
}

type IdentResolution =
  | { kind: 'strings'; values: string[] }
  | { kind: 'objects'; values: Array<Record<string, unknown>> }
  | { kind: 'objectKeys'; values: string[] };

/** Resolve an identifier to its top-level keys (used for `Object.keys(IDENT)`). */
function resolveIdentifierKeys(
  ident: string,
  fileContent: string,
  filePath: string,
  appDir: string,
  aliasMap: Map<string, string[]>,
  visited: Set<string>,
  depth: number,
): string[] | null {
  const r = resolveIdentifier(ident, fileContent, filePath, appDir, aliasMap, visited, depth);
  if (!r) return null;
  if (r.kind === 'objectKeys') return r.values;
  if (r.kind === 'objects') {
    // Treat array-of-objects' .keys as the array length — not meaningful. Skip.
    return null;
  }
  if (r.kind === 'strings') return r.values;
  return null;
}

function resolveIdentifierAsArray(
  ident: string,
  fileContent: string,
  filePath: string,
  appDir: string,
  aliasMap: Map<string, string[]>,
  visited: Set<string>,
  depth: number,
): IdentResolution | null {
  return resolveIdentifier(ident, fileContent, filePath, appDir, aliasMap, visited, depth);
}

/**
 * Resolve a TS identifier to a value:
 *  - top-level `const IDENT = { ... }`  → objectKeys
 *  - top-level `const IDENT = [ ... ]`  → strings or objects
 *  - default-import from a JSON file    → objectKeys / objects
 *  - re-exported / re-imported symbol   → follow one hop
 */
function resolveIdentifier(
  ident: string,
  fileContent: string,
  filePath: string,
  appDir: string,
  aliasMap: Map<string, string[]>,
  visited: Set<string>,
  depth: number,
): IdentResolution | null {
  if (depth > 5) return null;
  const visitKey = `${filePath}::${ident}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);

  // 1. Look for local const declaration
  const localValue = findLocalConst(ident, fileContent);
  if (localValue) {
    const parsed = parseLiteralValue(localValue);
    if (parsed) return parsed;
  }

  // 2. Look for import
  const importInfo = findImport(ident, fileContent);
  if (!importInfo) return null;

  const resolvedPath = resolveModulePath(importInfo.path, filePath, appDir, aliasMap);
  if (!resolvedPath) return null;

  // JSON file: parse directly
  if (resolvedPath.endsWith(JSON_EXT)) {
    try {
      const data = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
      return literalToResolution(data);
    } catch {
      return null;
    }
  }

  // TS/JS file: recursively resolve
  let nextContent: string;
  try {
    nextContent = readFileSync(resolvedPath, 'utf-8');
  } catch {
    return null;
  }

  // The export name in the next file. If default import, follow what default exports.
  // If named import, look up that name there.
  const nextIdent = importInfo.kind === 'default'
    ? findDefaultExportIdentifier(nextContent) ?? ident
    : importInfo.imported;

  return resolveIdentifier(nextIdent, nextContent, resolvedPath, appDir, aliasMap, visited, depth + 1);
}

interface ImportInfo {
  kind: 'default' | 'named';
  imported: string; // for named: original symbol name in the source module
  path: string;     // module specifier
}

/** Find an import declaration that brings `ident` into scope. */
function findImport(ident: string, source: string): ImportInfo | null {
  // import IDENT from 'PATH'  (default)
  const defRe = new RegExp(`import\\s+${ident}\\s+from\\s+['"]([^'"]+)['"]`, 'g');
  let m: RegExpExecArray | null;
  if ((m = defRe.exec(source)) !== null) {
    return { kind: 'default', imported: ident, path: m[1] };
  }

  // import { IDENT } from 'PATH' or { foo as IDENT }
  const namedRe = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = namedRe.exec(source)) !== null) {
    const specifiers = m[1].split(',').map(s => s.trim());
    for (const spec of specifiers) {
      const aliasMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(spec);
      if (aliasMatch) {
        if (aliasMatch[2] === ident) {
          return { kind: 'named', imported: aliasMatch[1], path: m[2] };
        }
      } else if (spec === ident) {
        return { kind: 'named', imported: ident, path: m[2] };
      }
    }
  }

  return null;
}

/** Resolve a module path (relative or alias) to an absolute file path. */
function resolveModulePath(
  spec: string,
  fromFile: string,
  appDir: string,
  aliasMap: Map<string, string[]>,
): string | null {
  let candidates: string[] = [];

  if (spec.startsWith('.')) {
    candidates.push(resolve(dirname(fromFile), spec));
  } else if (aliasMap.size > 0) {
    for (const [prefix, targets] of aliasMap.entries()) {
      if (spec === prefix.replace(/\/$/, '') || spec.startsWith(prefix)) {
        const sub = spec.slice(prefix.length);
        for (const t of targets) {
          candidates.push(sub ? join(t, sub) : t);
        }
      }
    }
  } else {
    // Bare specifier without alias — can't resolve. But try `appDir/spec` as last resort.
    candidates.push(join(appDir, spec));
  }

  for (const cand of candidates) {
    // Direct file (must be file, not directory)
    if (existsSync(cand)) {
      try {
        if (statSync(cand).isFile()) return cand;
      } catch { /* fallthrough */ }
    }
    for (const ext of [...TS_EXTS, JSON_EXT]) {
      if (existsSync(cand + ext)) return cand + ext;
    }
    // Index file in directory
    for (const ext of TS_EXTS) {
      const idx = join(cand, 'index' + ext);
      if (existsSync(idx)) return idx;
    }
  }
  return null;
}

/** Find `const IDENT = <expr>` (top-level) and return the raw expr. */
function findLocalConst(ident: string, source: string): string | null {
  const re = new RegExp(`(?:export\\s+)?const\\s+${ident}\\s*(?::[^=]+)?=\\s*`, 'g');
  const m = re.exec(source);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Read until end of statement (top-level `;` or end-of-line at depth 0)
  return readExpression(source, start);
}

function readExpression(source: string, start: number): string {
  let depth = 0;
  let inString: string | null = null;
  let i = start;
  for (; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    if (depth === 0 && (c === ';' || c === '\n')) break;
  }
  return source.slice(start, i).trim().replace(/[;]+$/, '').trim();
}

/** Find `export default IDENT;` and return IDENT. */
function findDefaultExportIdentifier(source: string): string | null {
  const m = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(source);
  return m ? m[1] : null;
}

/**
 * Parse a literal value expression into IdentResolution.
 * Supports `{...}`, `["a","b"]`, `[{...},{...}]`.
 */
function parseLiteralValue(expr: string): IdentResolution | null {
  expr = expr.trim();

  // Object literal — collect top-level keys
  if (expr.startsWith('{')) {
    const keys = extractTopLevelKeys(expr);
    if (keys.length > 0) return { kind: 'objectKeys', values: keys };
    return null;
  }

  // Array literal of strings
  if (expr.startsWith('[')) {
    const arrText = sliceTopLevelArray(expr);
    if (!arrText) return null;
    const stringRe = /["'`]([^"'`]*)["'`]/g;
    const inner = arrText.slice(1, -1);
    // If items are objects, parse as objects.
    if (/^\s*\{/.test(inner)) {
      const objs = parseObjectArray(arrText);
      if (objs) return { kind: 'objects', values: objs as Array<Record<string, unknown>> };
      return null;
    }
    const values: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = stringRe.exec(inner)) !== null) values.push(m[1]);
    if (values.length > 0) return { kind: 'strings', values };
  }

  return null;
}

/**
 * Extract top-level keys from a `{ key1: ..., "key2": ... }` literal.
 * Handles nested braces, strings, and bracket-quoted keys.
 */
function extractTopLevelKeys(expr: string): string[] {
  const inner = expr.slice(1, expr.length - 1);
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  let inString: string | null = null;
  let atKeyPos = true;

  while (i < inner.length) {
    const c = inner[i];

    if (inString) {
      if (c === '\\') { i += 2; continue; }
      if (c === inString) inString = null;
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      if (atKeyPos && depth === 0) {
        // Collect quoted key
        const quote = c;
        const end = inner.indexOf(quote, i + 1);
        if (end === -1) break;
        keys.push(inner.slice(i + 1, end));
        i = end + 1;
        // Skip whitespace then `:` then value
        while (i < inner.length && /\s/.test(inner[i])) i++;
        if (inner[i] === ':') {
          i++;
          atKeyPos = false;
        }
        continue;
      }
      inString = c;
      i++;
      continue;
    }

    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }

    if (depth === 0 && c === ',') { atKeyPos = true; i++; continue; }
    if (depth === 0 && c === ':') { atKeyPos = false; i++; continue; }

    if (atKeyPos && depth === 0 && /[A-Za-z_$]/.test(c)) {
      // Bareword key
      let j = i;
      while (j < inner.length && /[\w$]/.test(inner[j])) j++;
      const key = inner.slice(i, j);
      // Make sure it's a property key (followed by `:` after optional whitespace)
      let k = j;
      while (k < inner.length && /\s/.test(inner[k])) k++;
      if (inner[k] === ':') {
        keys.push(key);
        i = k + 1;
        atKeyPos = false;
        continue;
      }
      i = j;
      continue;
    }

    i++;
  }

  return keys;
}

/** Convert a parsed JSON value to an IdentResolution. */
function literalToResolution(data: unknown): IdentResolution | null {
  if (Array.isArray(data)) {
    if (data.every(v => typeof v === 'string')) {
      return { kind: 'strings', values: data as string[] };
    }
    if (data.every(v => v && typeof v === 'object')) {
      return { kind: 'objects', values: data as Array<Record<string, unknown>> };
    }
    return null;
  }
  if (data && typeof data === 'object') {
    return { kind: 'objectKeys', values: Object.keys(data as Record<string, unknown>) };
  }
  return null;
}
