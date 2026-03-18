# Pruny

> Find and remove unused code in Next.js and NestJS projects.

## Summary

Pruny is a TypeScript CLI tool that uses regex-based static analysis to detect and remove dead code. It scans for:

1. **Unused API Routes** - Next.js `route.ts` handlers and NestJS controller methods not referenced anywhere
2. **Broken Internal Links** - `<Link>`, `router.push()`, `redirect()`, `href: "/path"` in arrays/config objects pointing to pages that don't exist
3. **Unused Exports** - Named exports and class methods not imported by other files
4. **Unused Files** - Source files not reachable from any entry point (graph-based analysis)
5. **Unused NestJS Services** - Service methods not called by controllers or other services
6. **Public Assets** - Images/files in `public/` not referenced in code
7. **Source Assets** - Media files in source directories not referenced in code
8. **Missing Assets** - Code references to files in `public/` that don't exist

Works with monorepos, multi-tenant/subdomain architectures, and both Next.js App Router and Pages Router.

## Installation

```bash
npm install -g pruny
# or run directly
npx pruny
```

## Usage

### Interactive Mode

Scans your project and presents an interactive menu to review and fix issues.

```bash
npx pruny                # Scan current directory
npx pruny --app web      # Scan a specific app in a monorepo
npx pruny --dir ./src    # Scan a specific directory
```

### CI Mode

Scans all monorepo apps and exits with code 1 if any unused code is found. Use this in CI pipelines to block PRs with dead code.

```bash
npx pruny --all
```

### Fix Mode

Interactively select which unused items to delete. Pruny runs a second pass after deletion to catch newly orphaned code.

```bash
npx pruny --fix
```

### Dry Run

Simulates fix mode without making changes. Outputs a JSON report of what would be deleted.

```bash
npx pruny --dry-run
```

### Quick Cleanup

Target specific categories without the interactive menu:

```bash
npx pruny --cleanup routes          # Only clean unused routes
npx pruny --cleanup routes,exports  # Clean routes and exports
npx pruny --cleanup public,files    # Clean assets and files
```

### Other Flags

```bash
npx pruny --filter "users"          # Filter results by pattern
npx pruny --ignore-apps admin,docs  # Skip apps in monorepo scan
npx pruny --folder src/api          # Scan a specific folder only
npx pruny --no-public               # Skip public asset scanning
npx pruny --json                    # Output as JSON
npx pruny -v, --verbose             # Verbose debug output
npx pruny -c, --config <path>       # Specify config file path
npx pruny init                      # Generate pruny.config.json
```

## Configuration

Pruny looks for config files in your project root and recursively across the monorepo:
- `pruny.config.json`
- `.prunyrc.json`
- `.prunyrc`

Run `pruny init` to generate a default config.

### Full Config Example

```json
{
  "ignore": {
    "routes": ["/api/webhooks/**", "/api/cron/**"],
    "folders": ["node_modules", ".next", "dist", ".git"],
    "files": ["*.test.ts", "*.spec.ts"],
    "links": ["/custom-path", "/legacy/*"]
  },
  "extensions": [".ts", ".tsx", ".js", ".jsx"],
  "nestGlobalPrefix": "",
  "extraRoutePatterns": []
}
```

### Ignore Options

#### `ignore.routes`

Glob patterns for API routes to skip. Use this for webhook endpoints, cron handlers, or any route that is called externally and not referenced in your codebase.

```json
{ "ignore": { "routes": ["/api/webhooks/**", "/api/cron/**", "/api/stripe/webhook"] } }
```

#### `ignore.folders`

Directories to exclude from all scanning. Pruny automatically excludes `node_modules`, `.next`, `dist`, `build`, `.git`, `coverage`, and anything in your `.gitignore`.

```json
{ "ignore": { "folders": ["scripts", "migrations"] } }
```

#### `ignore.files`

File patterns to exclude from scanning.

```json
{ "ignore": { "files": ["*.test.ts", "*.spec.ts", "*.stories.tsx"] } }
```

#### `ignore.links`

Suppress broken internal link warnings for specific paths. This is useful when:

- **Multi-tenant apps**: Routes like `/view_seat` resolve at runtime via subdomain routing and middleware, not through file-system paths
- **Reverse proxy routes**: Paths handled by nginx/Caddy that don't have corresponding page files
- **External redirects**: Paths that redirect to other domains

```json
{ "ignore": { "links": ["/view_seat", "/review", "/admin/*"] } }
```

All patterns support glob syntax: `*` matches any characters, `**` matches nested paths.

### Additional Options

| Key | Type | Description |
| :-- | :--- | :---------- |
| `nestGlobalPrefix` | `string` | NestJS global route prefix (e.g., `"api/v1"`) |
| `extraRoutePatterns` | `string[]` | Additional glob patterns to detect route files |
| `excludePublic` | `boolean` | Set `true` to skip public asset scanning entirely |

## How Pruny Detects Issues

### API Route Detection

- **Next.js**: Finds all `app/api/**/route.{ts,tsx,js,jsx}` files and checks if their HTTP methods (GET, POST, etc.) are referenced via `fetch`, `axios`, `got`, `ky`, `useSWR`, or string literals
- **NestJS**: Finds `*.controller.ts` files, extracts routes from decorators (`@Get()`, `@Post()`, etc.), and checks for references

### Broken Link Detection

Pruny extracts internal link references from these patterns:
- `<Link href="/path">` (React/Next.js)
- `router.push("/path")` / `router.replace("/path")`
- `redirect("/path")` / `permanentRedirect("/path")`
- `href: "/path"` (navigation config objects)
- `<a href="/path">` (HTML)
- `revalidatePath("/path")`
- `pathname === "/path"` (usePathname comparisons)

This means links defined in arrays and rendered via `.map()` are detected — a common pattern for navigation menus, footer links, and sidebar items:

```tsx
const navLinks = [
  { href: "/about", label: "About" },        // checked
  { href: "/nonexistent", label: "Missing" }, // flagged as broken
];
// Later: navLinks.map(item => <Link href={item.href}>...)
```

All paths are validated against the known routes built from your `app/**/page.tsx` file tree. Dynamic segments (`[id]`, `[...slug]`, `[[...slug]]`) are matched correctly.

The summary table always shows an "Internal Links" row when links are scanned, displaying Total/Valid/Broken counts so you can see the feature is active even with 0 broken links.

**Multi-tenant routing**: If a link like `/view_seat` is not a direct route but exists under a dynamic parent (e.g., `app/tenant/[domain]/view_seat/page.tsx`), Pruny recognizes it as valid. The matched tail must contain at least one literal segment (e.g., `view_seat`) — fully-dynamic tails like `[token]` alone won't match arbitrary paths. This handles subdomain-based multi-tenant architectures automatically.

### Unused Exports

Scans all named exports (`export function`, `export const`, `export class`, `export type`, etc.) and checks if they are imported by any other file. Uses worker threads for projects with 500+ files.

### Unused Files

Performs graph-based reachability analysis starting from entry points (pages, routes, layout files). Files not reachable from any entry point are flagged.

### Unused NestJS Services

Analyzes `*.service.ts` files and checks if each public method is called by any controller or other service.

## Monorepo Support

Pruny auto-detects monorepos by looking for an `apps/` directory. When running in monorepo mode:

- Each app is scanned independently for routes and exports
- References are checked across the **entire monorepo root** (so shared packages count)
- Config files from all apps are discovered and merged

```bash
# Scan everything (CI mode)
pruny --all

# Scan one app
pruny --app web

# Skip certain apps
pruny --ignore-apps admin,docs
```

## Multi-Tenant / Subdomain Routing

If your app uses subdomain-based routing (e.g., `{tenant}.yourapp.com`), your routes might live under dynamic segments:

```
app/(code)/tenant_sites/[domain]/view_seat/page.tsx
app/(code)/tenant_sites/[domain]/review/page.tsx
```

Components reference these as `/view_seat` or `/review` (resolved by middleware at runtime). Pruny automatically detects this pattern and will **not** flag these as broken links.

If Pruny still reports false positives for your specific routing setup, add them to `ignore.links`:

```json
{
  "ignore": {
    "links": ["/view_seat", "/review", "/custom-page"]
  }
}
```

## Vercel Cron Detection

Routes listed in `vercel.json` cron jobs are automatically marked as used:

```json
{
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 0 * * *" }
  ]
}
```

This prevents accidental deletion of server-side cron handlers that have no client-side references.

## Debug Mode

Set `DEBUG_PRUNY=1` to enable verbose logging across all scanners:

```bash
DEBUG_PRUNY=1 pruny
```

## Advanced Usage

### Dynamic Routes & Custom Clients

Pruny detects API usage by scanning for string literal patterns:

- **Detected**: `fetch('/api/users')`, `` fetch(`/api/users/${id}`) ``, `axios.get('/api/items')`, `useSWR('/api/data')`
- **Not detected**: `fetch(myUrlVariable)` where the path is fully dynamic with no `/api/` prefix

For routes called only by external systems (webhooks, crons), add them to `ignore.routes`.

### HTTP Usage Tracking

Pruny tracks how many HTTP client calls exist in your codebase, broken down by library: `fetch`, `axios`, `got`, `ky`. This helps identify migration opportunities.

## Source Code

- Repository: https://github.com/WebNaresh/pruny
- Registry: https://www.npmjs.com/package/pruny
