import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import type { Config } from '../types.js';

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
 * Each captures a path starting with / in group 1 (or group 2 for router patterns).
 */
const LINK_PATTERNS: RegExp[] = [
  // <Link href="/path"> or <Link href='/path'>
  /<Link\s+[^>]*href\s*=\s*['"`](\/[^'"`\s{}$]+)['"`]/g,

  // router.push("/path") / router.replace("/path")
  /router\.(push|replace)\s*\(\s*['"`](\/[^'"`\s{}$]+)['"`]/g,

  // redirect("/path") / permanentRedirect("/path")
  /(?:redirect|permanentRedirect)\s*\(\s*['"`](\/[^'"`\s{}$]+)['"`]/g,

  // href: "/path" (navigation config objects)
  /href\s*:\s*['"`](\/[^'"`\s{}$]+)['"`]/g,

  // <a href="/path"> (plain HTML)
  /<a\s+[^>]*href\s*=\s*['"`](\/[^'"`\s{}$]+)['"`]/g,

  // revalidatePath("/path")
  /revalidatePath\s*\(\s*['"`](\/[^'"`\s{}$]+)['"`]/g,

  // pathname === "/path" or pathname === '/path' (usePathname comparisons)
  /pathname\s*===?\s*['"`](\/[^'"`\s{}$]+)['"`]/g,
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
 * Check if a referenced path matches any known route.
 * Handles dynamic segments [slug] and catch-all [...slug].
 * Also handles multi-tenant/subdomain routing where links like /view_seat
 * resolve under dynamic parent routes like /tenant/[domain]/view_seat.
 */
function matchesRoute(refPath: string, routes: Set<string>, routeSegments: string[][]): boolean {
  const cleaned = cleanPath(refPath);

  // Exact match
  if (routes.has(cleaned)) return true;

  // Check against dynamic routes
  const refSegments = cleaned.split('/').filter(Boolean);

  for (const routeSeg of routeSegments) {
    if (matchSegments(refSegments, routeSeg)) return true;

    // Multi-tenant/subdomain routing: a link like /view_seat may resolve to
    // /tenant_sites/[domain]/view_seat at runtime via middleware/subdomain routing.
    // Check if the link path matches the tail of a dynamic route.
    if (matchesDynamicSuffix(refSegments, routeSeg)) return true;
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
 */
function matchSegments(refSegments: string[], routeSegments: string[]): boolean {
  let ri = 0;
  let si = 0;

  while (ri < refSegments.length && si < routeSegments.length) {
    const routeSeg = routeSegments[si];

    // Catch-all: [...slug] or [[...slug]] — matches rest of path
    if (/^\[\[?\.\.\./.test(routeSeg)) return true;

    // Dynamic segment: [id] — matches any single segment
    if (/^\[.+\]$/.test(routeSeg)) {
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
  const routeSegmentsList: string[][] = [];

  // Always add root route
  knownRoutes.add('/');

  for (const file of pageFiles) {
    const route = filePathToRoute(file);
    knownRoutes.add(route);

    // Store segments for dynamic matching
    const segments = route.split('/').filter(Boolean);
    if (segments.some(s => s.startsWith('['))) {
      routeSegmentsList.push(segments);
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

  const sourceFiles = await fg(globPattern, {
    cwd: refDir,
    ignore,
    absolute: true,
  });

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
          const rawPath = extractPath(match);
          if (!rawPath) continue;
          if (shouldSkipPath(rawPath)) continue;

          const cleaned = cleanPath(rawPath);
          if (!cleaned || cleaned === '/') continue;

          allLinkPaths.add(cleaned);

          // Check if route exists
          if (!matchesRoute(cleaned, knownRoutes, routeSegmentsList)) {
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
