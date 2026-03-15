# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pruny is a TypeScript CLI tool that finds and removes unused code in Next.js and NestJS projects. It detects unused API routes, broken internal links, controller methods, public assets, source files, named exports, and service methods using regex-based static analysis (not AST parsing).

## Build & Dev Commands

```bash
bun run build        # Build with Bun bundler (main + worker thread)
bun run dev          # Run src/index.ts directly without building
bun run lint         # ESLint on src/**
bun run validate     # Lint + TypeScript type check (tsc --noEmit)
bun run audit        # Build then run dist/index.js
pruny --all          # CI mode: scan all apps, exit 1 if issues found
```

Tests use `bun:test`. Run with `bun test`. Fixtures are in `tests/fixtures/nextjs-app/`.

## Architecture

**Entry point**: `bin/pruny.js` -> `dist/index.js` (compiled from `src/index.ts`)

**Core flow**: `src/index.ts` (CLI/UI via Commander.js) -> `src/scanner.ts` (orchestrator) -> individual scanners in `src/scanners/`

### Source modules

- **`src/index.ts`** — CLI setup, interactive prompts, monorepo detection, fix mode with cascading deletion, report output
- **`src/scanner.ts`** — Orchestrates all sub-scanners, returns `ScanResult`
- **`src/patterns.ts`** — All regex patterns for detecting API routes, fetch/axios/SWR calls, NestJS decorators
- **`src/fixer.ts`** — File modification logic: removes methods, exports, and decorators using brace-counting for boundary detection
- **`src/config.ts`** — Config loading (`pruny.config.json`, `.prunyrc`), `.gitignore` integration, config merging
- **`src/types.ts`** — All TypeScript interfaces (`Config`, `ApiRoute`, `ScanResult`, `UnusedExport`, etc.)
- **`src/constants.ts`** — Shared constants (ignored exports, lifecycle methods, invalid names, regexes)
- **`src/utils.ts`** — Shared utilities (path resolution, filter matching, regex helpers, brace-count sanitization)
- **`src/init.ts`** — `pruny init` subcommand

### Scanners (`src/scanners/`)

Each scanner is a standalone module called by `scanner.ts`:
- `broken-links.ts` — Validates internal link references (`<Link>`, `router.push`, `redirect`, etc.) against known page routes. Supports dynamic segments and multi-tenant subdomain routing (auto-detects routes under `[domain]`-style parents)
- `unused-files.ts` — Graph-based reachability analysis from entry points
- `unused-exports.ts` — Named export and class method usage (uses worker threads for 500+ files via `src/workers/file-processor.ts`)
- `unused-services.ts` — NestJS service method usage analysis
- `public-assets.ts` — Unused files in `public/`
- `source-assets.ts` — Unused media files in source directories
- `missing-assets.ts` — References to non-existent public assets
- `http-usage.ts` — HTTP client call site counts (axios, fetch, got, ky)

## Key Design Decisions

- **Regex over AST**: All code analysis uses regex pattern matching from `src/patterns.ts`, not an AST parser. Changes to detection logic should update patterns there. The broken links scanner (`src/scanners/broken-links.ts`) has its own link-extraction patterns separate from `patterns.ts`.
- **Two-pass deletion**: Fix mode runs a second `scanUnusedExports()` pass after deleting routes to catch newly dead code. Service files (`.service.ts`) are skipped in the second pass.
- **Worker threads**: `unused-exports.ts` splits work across 2 workers for large projects (500+ files).
- **Monorepo awareness**: Walks up directory tree looking for `apps/` directory; scans routes within the target app but checks references across the full monorepo root.
- **CI mode (`--all`)**: Non-interactive flag that scans all monorepo apps and exits with code 1 if any unused code is found. Suppresses interactive prompts and "Run with --fix" hints.
- **ESM only**: Package uses `"type": "module"` throughout.
- **Multi-tenant route matching**: The broken links scanner uses `matchesDynamicSuffix()` to recognize that `/view_seat` is valid when a route like `/tenant/[domain]/view_seat` exists. Users can also manually suppress false positives via `ignore.links` in config.
- **Config `ignore.links`**: Separate from `ignore.routes` — `routes` is for API endpoints, `links` is for page-level broken link suppression. Both are checked when filtering broken links (backward compatible).
- **GitHub Actions workflow scanning**: `getGitHubWorkflowPaths()` in `scanner.ts` scans `.github/workflows/*.{yml,yaml}` for `/api/...` references (curl commands, fetch calls, plugin configs). Routes found are marked as used with `.github/workflows` in references. In monorepos, both the app dir and repo root are checked for workflow files.
- **External route auto-detection**: `getAutoDetectedExternalRoutes()` checks `package.json` dependencies for known libraries that create external routes (next-auth → `/api/auth/**`, inngest → `/api/inngest`). These are marked as used with `(auto-detected external)` in references.
- **Default ignored folders**: `config.ts` hardcodes common folders (`node_modules`, `.next`, `.git`, `dist`, `.turbo`, `.cache`, `.vercel`, `.husky`, `.swc`, `generated`, `storybook-static`, `build`, `out`, `coverage`) so users don't need to manually ignore them.

## Bug Fix & Feature Completion Rules

### Regression Tests (mandatory)
Every bug fix MUST include a regression test. When fixing a GitHub issue:
1. Write a test in `tests/` that reproduces the exact bug scenario described in the issue
2. Add edge-case tests (different file formats, missing directories, multiple matches, no matches)
3. The test must fail without the fix and pass with it
4. Run `bun run validate` to confirm all tests pass before considering the fix complete

This prevents the same bug from resurfacing in future releases.

### Documentation Updates (mandatory)
After every fix or feature, update this `CLAUDE.md` file if the change affects:
- **Architecture**: New scanner, module, or integration point → update "Source modules" or "Scanners" section
- **Design decisions**: New pattern or strategy (e.g., external route detection) → add to "Key Design Decisions"
- **Config options**: New ignore pattern, config field, or CLI flag → document it
- **Build/dev commands**: New scripts or changed workflows → update "Build & Dev Commands"

Documentation must reflect the current state of the codebase — not the state it was in when initially written.

## Debug Mode

Set `DEBUG_PRUNY=1` to enable verbose logging across all modules.

## Conventions

- ESLint flat config with `typescript-eslint` and `eslint-plugin-unused-imports`
- Unused variables prefixed with `_` are allowed
- Semantic release on `main` branch (`.releaserc.json`)
- Bun is used as the package manager and bundler
