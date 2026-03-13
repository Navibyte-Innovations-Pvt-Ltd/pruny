# pruny

Find and remove unused code in Next.js and NestJS projects.

Pruny scans your codebase using regex-based static analysis to detect unused API routes, page links, exports, files, public assets, and NestJS service methods. Works with monorepos out of the box.

## Install

```bash
npm install -g pruny
# or
npx pruny
```

## What It Detects

| Scanner | What it finds |
| :------ | :------------ |
| **API Routes** | Unused Next.js `route.ts` handlers and NestJS controller methods |
| **Broken Links** | `<Link>`, `router.push()`, `redirect()` pointing to pages that don't exist |
| **Unused Exports** | Named exports and class methods not imported anywhere |
| **Unused Files** | Source files not reachable from any entry point |
| **Unused Services** | NestJS service methods never called by controllers or other services |
| **Public Assets** | Images/files in `public/` not referenced in code |
| **Source Assets** | Media files in `src/` not referenced in code |
| **Missing Assets** | References to files in `public/` that don't exist |

## CLI Commands

| Command | Description |
| :------ | :---------- |
| `pruny` | Interactive scan (auto-detects monorepo apps) |
| `pruny --all` | CI mode: scan all apps, exit 1 if issues found |
| `pruny --fix` | Interactively delete unused items |
| `pruny --dry-run` | Simulate fix mode and output a JSON report |
| `pruny --app <name>` | Scan a specific app in a monorepo |
| `pruny --folder <path>` | Scan a specific folder for routes/controllers |
| `pruny --cleanup <items>` | Quick cleanup: `routes`, `exports`, `public`, `files` |
| `pruny --filter <pattern>` | Filter results by path or app name |
| `pruny --ignore-apps <list>` | Skip specific apps (comma-separated) |
| `pruny --no-public` | Skip public asset scanning |
| `pruny --json` | Output results as JSON |
| `pruny -v, --verbose` | Verbose debug logging |
| `pruny --dir <path>` | Set target directory (default: `./`) |
| `pruny -c, --config <path>` | Path to config file |
| `pruny init` | Generate a `pruny.config.json` with defaults |

## Configuration

Create `pruny.config.json` in your project root (or run `pruny init`):

```json
{
  "ignore": {
    "routes": ["/api/webhooks/**", "/api/cron/**"],
    "folders": ["node_modules", ".next", "dist"],
    "files": ["*.test.ts", "*.spec.ts"],
    "links": ["/custom-path", "/legacy/*"]
  },
  "extensions": [".ts", ".tsx", ".js", ".jsx"]
}
```

### Ignore Options

| Key | What it does | Example |
| :-- | :----------- | :------ |
| `ignore.routes` | Skip API routes matching these patterns | `["/api/webhooks/**"]` |
| `ignore.folders` | Exclude directories from scanning | `["node_modules", "dist"]` |
| `ignore.files` | Exclude specific files from scanning | `["*.test.ts"]` |
| `ignore.links` | Suppress broken link warnings for these paths | `["/view_seat", "/admin/*"]` |

All patterns support glob syntax (`*` matches any characters, `**` matches nested paths).

Pruny also reads `.gitignore` and automatically excludes those folders.

### Additional Config Options

| Key | What it does |
| :-- | :----------- |
| `nestGlobalPrefix` | NestJS global route prefix (e.g., `"api/v1"`) |
| `extraRoutePatterns` | Additional glob patterns to detect route files |
| `excludePublic` | Set `true` to skip public asset scanning |

### Config File Locations

Pruny searches for config files recursively across your project:
- `pruny.config.json`
- `.prunyrc.json`
- `.prunyrc`

In monorepos, configs from multiple apps are merged together. CLI `--config` takes precedence.

## Multi-Tenant / Subdomain Routing

Pruny automatically handles multi-tenant architectures where routes live under dynamic segments like `[domain]`.

For example, if your file structure is:
```
app/(code)/tenant_sites/[domain]/view_seat/page.tsx
```

And your components reference `/view_seat` (resolved at runtime via subdomain), Pruny recognizes this as a valid route and will **not** report it as a broken link.

If auto-detection doesn't cover your case, use `ignore.links` in config:

```json
{
  "ignore": {
    "links": ["/view_seat", "/review", "/custom-path"]
  }
}
```

## Monorepo Support

Pruny auto-detects monorepos by looking for an `apps/` directory. It scans each app independently but checks references across the entire monorepo root.

```bash
# Scan all apps (CI-friendly, exits 1 on issues)
pruny --all

# Scan a specific app
pruny --app web

# Skip certain apps
pruny --ignore-apps admin,docs
```

## CI Integration

Add to your CI pipeline to catch unused code before merging:

```bash
npx pruny --all
```

This scans all monorepo apps and exits with code 1 if any issues are found. Combine with `--json` for machine-readable output.

## How It Works

1. **Route Detection**: Finds all `app/api/**/route.ts` (Next.js) and `*.controller.ts` (NestJS) files
2. **Link Detection**: Finds `<Link>`, `router.push()`, `redirect()`, `href:` patterns and validates against known page routes
3. **Reference Scanning**: Searches the entire codebase for string references to routes, exports, and assets
4. **Dynamic Route Matching**: Understands `[id]`, `[...slug]`, `[[...slug]]` dynamic segments
5. **Fix Mode**: Removes unused methods, exports, and files with a cascading second pass to catch newly dead code

### Vercel Cron Detection

Routes listed in `vercel.json` cron jobs are automatically marked as used:
```json
{ "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 0 * * *" }] }
```

## Debug Mode

```bash
DEBUG_PRUNY=1 pruny
```

Enables verbose logging across all scanners.

## License

MIT
