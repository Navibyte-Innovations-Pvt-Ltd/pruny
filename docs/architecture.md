# Architecture

**Entry point**: `bin/pruny.js` -> `dist/index.js` (compiled from `src/index.ts`)

**Core flow**: `src/index.ts` (CLI/UI via Commander.js) -> `src/scanner.ts` (orchestrator) -> individual scanners in `src/scanners/`

## Source modules

- **`src/index.ts`** — CLI setup, interactive prompts, monorepo detection, fix mode with cascading deletion, report output
- **`src/scanner.ts`** — Orchestrates all sub-scanners, returns `ScanResult`
- **`src/patterns.ts`** — All regex patterns for detecting API routes, fetch/axios/SWR calls, NestJS decorators
- **`src/fixer.ts`** — File modification logic: removes methods, exports, and decorators using brace-counting for boundary detection
- **`src/config.ts`** — Config loading (`pruny.config.json`, `.prunyrc`), `.gitignore` integration, config merging
- **`src/types.ts`** — All TypeScript interfaces (`Config`, `ApiRoute`, `ScanResult`, `UnusedExport`, etc.)
- **`src/constants.ts`** — Shared constants (ignored exports, lifecycle methods, invalid names, regexes)
- **`src/utils.ts`** — Shared utilities (path resolution, filter matching, regex helpers, brace-count sanitization)
- **`src/init.ts`** — `pruny init` subcommand

## Scanners (`src/scanners/`)

Each scanner is a standalone module called by `scanner.ts`:

- `broken-links.ts` — Validates internal link references (`<Link>`, `router.push`, `redirect`, etc.) against known page routes. Supports dynamic segments, multi-tenant subdomain routing (auto-detects routes under `[domain]`-style parents), `generateStaticParams` resolution, and public static file resolution.
- `unused-files.ts` — Graph-based reachability analysis from entry points
- `unused-exports.ts` — Named export and class method usage (uses worker threads for 500+ files via `src/workers/file-processor.ts`)
- `unused-services.ts` — NestJS service method usage analysis
- `public-assets.ts` — Unused files in `public/`
- `source-assets.ts` — Unused media files in source directories
- `missing-assets.ts` — References to non-existent public assets
- `http-usage.ts` — HTTP client call site counts (axios, fetch, got, ky)

## Debug

Set `DEBUG_PRUNY=1` to enable verbose logging across all modules.

## Conventions

- ESLint flat config with `typescript-eslint` and `eslint-plugin-unused-imports`
- Unused variables prefixed with `_` are allowed
- Semantic release on `main` branch (`.releaserc.json`)
- Bun is the package manager + bundler
- ESM only (`"type": "module"`)
