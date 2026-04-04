/**
 * Regex patterns to detect API route usage in source files
 */
export const API_PATTERNS: RegExp[] = [
  // fetch('/api/...')
  /fetch\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // fetch(`/api/...`)
  /fetch\s*\(\s*`\/api\/([^`\s)]+)`/g,

  // axios.get('/api/...')
  /axios\.\w+\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // useSWR('/api/...')
  /useSWR\s*(?:<[^>]+>)?\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // useQuery with /api/
  /queryFn.*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // Generic string containing /api/
  /['"`]\/api\/([^'"`\s]+)['"`]/g,

  // Full URL matching (http://.../api/...)
  /['"`](?:https?:\/\/[^/]+)?\/api\/([^'"`\s]+)['"`]/g,

  // Template literal with variable prefix: `${baseUrl}/api/...`
  /`[^`]*\/api\/([^`\s]+)`/g,
];

/**
 * Regex to find exported HTTP methods in route.ts files
 * Matches: export async function GET, export const POST, etc.
 */
export const EXPORTED_METHOD_PATTERN = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/g;

/**
 * NestJS Controller Pattern
 * Matches: @Controller('users') or @Controller()
 */
export const NEST_CONTROLLER_PATTERN = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;

/**
 * NestJS Method Pattern
 * Matches: @Get('profile'), @Post(), etc.
 */
export const NEST_METHOD_PATTERN = /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;

export interface ApiReference {
  path: string;
  method?: string;
  /** Where this reference came from: 'http-client' (fetch/axios/useSWR) or 'generic' (string literal) */
  source: 'http-client' | 'generic';
}

export const API_METHOD_PATTERNS: { regex: RegExp; method?: string; source: 'http-client' | 'generic' }[] = [
  // axios.get/post/put/delete/patch (Literals)
  { regex: /(?:axios|api|http|client|service)!?\.get\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'GET', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.post\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'POST', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.put\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'PUT', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.delete\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'DELETE', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.patch\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'PATCH', source: 'http-client' },

  // axios.get/post/put/delete/patch (Template Literals)
  // Anchored patterns (axios.get(`, fetch(`, useSWR(`) are safe to allow newlines
  // because the function-call prefix prevents cross-literal false matches.
  { regex: /(?:axios|api|http|client|service)!?\.get\s*(?:<[^>]+>)?\s*\(\s*`([^`]*?\/[^`]*)`/g, method: 'GET', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.post\s*(?:<[^>]+>)?\s*\(\s*`([^`]*?\/[^`]*)`/g, method: 'POST', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.put\s*(?:<[^>]+>)?\s*\(\s*`([^`]*?\/[^`]*)`/g, method: 'PUT', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.delete\s*(?:<[^>]+>)?\s*\(\s*`([^`]*?\/[^`]*)`/g, method: 'DELETE', source: 'http-client' },
  { regex: /(?:axios|api|http|client|service)!?\.patch\s*(?:<[^>]+>)?\s*\(\s*`([^`]*?\/[^`]*)`/g, method: 'PATCH', source: 'http-client' },

  // useSWR default is GET
  { regex: /useSWR\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'GET', source: 'http-client' },
  { regex: /useSWR\s*(?:<[^>]+>)?\s*\(\s*`([^`]*?\/[^`]*)`/g, method: 'GET', source: 'http-client' },

  // Generic patterns (fetch is anchored, safe for multi-line)
  { regex: /fetch\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: undefined, source: 'http-client' },
  { regex: /fetch\s*\(\s*`([^`]*?\/[^`]*)`/g, method: undefined, source: 'http-client' },

  // Paths starting with /api/ — these are API-specific so treated as http-client
  { regex: /['"`](\/api\/[^'"`\s]+)['"`]/g, method: undefined, source: 'http-client' },
  { regex: /`([^`\n]*?\/api\/[^`\n]*)`/g, method: undefined, source: 'http-client' },

  // /api/ paths inside multiline template literals (e.g. XML/HTML builders)
  // Cap pre/post context to 500 chars to prevent spanning across unrelated template literals
  // when a closing backtick of one literal and opening backtick of another have no backticks between them
  { regex: /`[^`]{0,500}?(\/api\/[\w-]+(?:\/[\w-]+)*(?:\/\$\{[^}]+\})*)[^`]{0,500}?`/gs, method: undefined, source: 'http-client' },

  // Template literal with API URL env var prefix (e.g. `${process.env.NEXT_PUBLIC_API_URL}/auth/login`)
  // These are clearly HTTP calls, not page navigation. Allow ${} interpolations in the path.
  { regex: /`[^`\n]*(?:API_URL|BASE_URL|BACKEND_URL|SERVER_URL)\}(\/[^`\n]*)`/g, method: undefined, source: 'http-client' },

  // Template literal with variable prefix: `${baseUrl}/...` or `/api/...` - allow assignments (remove suffix validation)
  // IMPORTANT: Use [^`\n] for UN-ANCHORED patterns to prevent false multi-line matches
  // where the regex spans from one template literal's closing backtick to another's opening backtick.
  // Anchored patterns (fetch(`, axios.get(`) are safe to allow newlines.
  { regex: /`([^`\n]*?(\/[\w-]{2,}\/[^`\n]*))`/g, method: undefined, source: 'generic' },

  // Full URLs (http:// or https://) - capture path
  // This allows capturing single-segment paths like /health which would otherwise be ignored by the generic pattern
  { regex: /https?:\/\/[^/]+(\/[^'"`\s]*)/g, method: undefined, source: 'http-client' },

  // Generic path-like strings in literals (at least 1 segment if starting with /, or 2 if containing slashes)
  { regex: /['"`](\/[\w-]{2,}\/[^'"`\s]*)['"`]/g, method: undefined, source: 'generic' },
  { regex: /['"`](\/api\/[^'"`\s]*)['"`]/g, method: undefined, source: 'http-client' },
];

/**
 * Extract all API paths referenced in content with potential methods
 */
export function extractApiReferences(content: string): ApiReference[] {
  interface Match {
    path: string;
    method?: string;
    source: 'http-client' | 'generic';
    start: number;
    end: number;
  }

  const matches: Match[] = [];

  for (const { regex, method, source } of API_METHOD_PATTERNS) {
    regex.lastIndex = 0;

    let regexMatch: RegExpExecArray | null;
    while ((regexMatch = regex.exec(content)) !== null) {
      if (regexMatch[1]) {
        matches.push({
          path: regexMatch[1],
          method,
          source,
          start: regexMatch.index,
          end: regexMatch.index + regexMatch[0].length,
        });
      }
    }
  }

  // Deduction/filtering Strategy:
  // 1. Prioritize matches with a Method (e.g. axios.get) over generic ones.
  // 2. Prioritize longer matches (captures more context) over shorter ones (e.g. fetch(...) > 'string').
  // 3. Keep the first one encountered if duplicates.
  
  // Sort matches by quality
  matches.sort((a, b) => {
    // 1. Method priority
    const aHasMethod = a.method !== undefined;
    const bHasMethod = b.method !== undefined;
    if (aHasMethod && !bHasMethod) return -1; // a comes first
    if (!aHasMethod && bHasMethod) return 1;  // b comes first
    
    // 2. Length priority (Longer is better)
    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (aLen !== bLen) return bLen - aLen; // Descending length
    
    // 3. Position priority (Earlier is better, mostly for stability)
    return a.start - b.start;
  });

  const acceptedMatches: Match[] = [];

  for (const match of matches) {
    // Check if this match is redundant (contained within an already accepted match WITH THE SAME PATH)
    // Two different API paths should never suppress each other even if one regex span contains the other
    const isRedundant = acceptedMatches.some(accepted => {
        return accepted.path === match.path && accepted.start <= match.start && accepted.end >= match.end;
    });

    if (!isRedundant) {
        acceptedMatches.push(match);
    }
  }

  // Deduplication by key (path + method)
  const references: ApiReference[] = [];
  const seen = new Set<string>();

  for (const match of acceptedMatches) {
    const key = `${match.path}::${match.method || 'ANY'}`;
    if (!seen.has(key)) {
      references.push({ path: match.path, method: match.method, source: match.source });
      seen.add(key);
    } else {
      // If already seen but this one is http-client, upgrade the source
      if (match.source === 'http-client') {
        const existing = references.find(r => `${r.path}::${r.method || 'ANY'}` === key);
        if (existing && existing.source === 'generic') {
          existing.source = 'http-client';
        }
      }
    }
  }

  return references;
}
