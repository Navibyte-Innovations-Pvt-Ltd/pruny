# Key Design Decisions

Detailed rationale and implementation notes for non-obvious behavior. Update this file when adding a new pattern or strategy.

## Detection strategy

- **Regex over AST**: All code analysis uses regex pattern matching from `src/patterns.ts`, not an AST parser. Changes to detection logic should update patterns there. The broken-links scanner (`src/scanners/broken-links.ts`) has its own link-extraction patterns separate from `patterns.ts`. The unused-files scanner (`src/scanners/unused-files.ts`) also has its own import regex that handles `from '...'`, `import('...')` (including webpack magic comments like `/* webpackChunkName */`), and `require('...')`.
- **Two-pass deletion**: Fix mode runs a second `scanUnusedExports()` pass after deleting routes to catch newly dead code. Service files (`.service.ts`) are skipped in the second pass.
- **Worker threads**: `unused-exports.ts` splits work across 2 workers for large projects (500+ files), except when the shared file cache is active (see Performance) — then every file is already in memory on the main thread and workers would only re-read and clone it.

## Performance

Budget: a 2.7k-file Next.js app (practice-stack `web`) scans in ~5s. Before these changes it took ~445s. Keep every check below O(files) per item — any loop of shape "for each export/method/route × for each file" must go through an index or a per-item cache.

- **Token index for export usage** (`buildReferenceIndex` in `unused-exports.ts`): maps every `\w+` token to the files containing it. Each export only visits files whose content contains its name as a whole token. This is exact, not a heuristic: every usage check (`\bname\b`, JSX `<name`, `import … name … from`) needs the name as a maximal `\w+` run. Names with a non-`\w` character (`$store`) skip the index and scan every file. Per-file derived data (lines, string-stripped content, `/apps/<x>/` membership) is computed once per file and memoized. Tests: `tests/exports-token-index.test.ts`.
- **Service method usage** (`unused-services.ts`): the list of files importing a service class, along with the property names bound to it, is computed once per service. Methods only check that list. Previously every method re-read every file from disk.
- **Glob matching** (`matchGlob` in `utils.ts`): same result as `minimatch()`, but each compiled `Minimatch` is cached by pattern. `checkRouteUsage` calls this routes × references × variations times.
- **Shared file cache** (`startFileCache` / `readSourceFile` in `utils.ts`): scanners read source files through `readSourceFile`. The CLI starts a fresh cache at the beginning of each non-fix pass, so all scanners and all apps in `--all` share one read per file. **Fix mode never enables it**, because the fixer edits files between scans and rescan must see disk. The cache is off by default, so tests and library callers always read from disk. Do not enable it anywhere files may change mid-run.
- **Verifying a perf change**: compare full `--json` output before and after on practice-stack, abhyaiska, and a repo with non-zero unused items (e.g. glitchgrab). Sort arrays before diffing and ignore `publicAssets[].references`: it records the first-found file, which depends on glob order and differs from run to run.
- **Known pre-existing limitations** kept as-is by the perf work: `$`-prefixed exports are always reported unused (`\b` never matches before `$`), and a name mentioned only in a `//` comment in another file counts as used (the fast path strips strings, not comments).

## Project layout & monorepo

- **Monorepo awareness**: Walks up directory tree looking for `apps/` directory; scans routes within the target app but checks references across the full monorepo root.
- **CI mode (`--all`)**: Non-interactive flag that scans all monorepo apps and exits with code 1 if any unused code is found. Suppresses interactive prompts and "Run with --fix" hints. In `--all --fix` mode, apps with 0 issues are auto-skipped so the menu opens only for apps with actionable items.
- **Default ignored folders**: `config.ts` hardcodes common folders (`node_modules`, `.next`, `.git`, `dist`, `.turbo`, `.cache`, `.vercel`, `.husky`, `.swc`, `generated`, `storybook-static`, `build`, `out`, `coverage`, `ios`, `android`) so users don't need to manually ignore them.

## Broken-links scanner

- **Static-params slug validation**: `resolveStaticParams()` parses each dynamic route's `generateStaticParams` and constrains link matches to the resolved concrete values. Supports literal arrays (`[{slug:"x"}]`), string-array `.map(...)`, `Object.keys(IDENT).map(...)`, and `IDENT.map(item => ({slug: item.field}))`. Identifier resolution follows imports across `@/` aliases and re-exports up to 5 hops, including `.json` defaults parsed directly. When the function is missing or unresolvable the scanner falls back to permissive matching to avoid false positives. So a hardcoded `<Link href="/services/foo-bar">` against `/services/[slug]/page.tsx` with a JSON-backed key set will be flagged when `foo-bar` is not in the keys.
- **Template-literal interpolation — skip entirely**: If a captured href contains `${...}` (e.g., `` href={`/business-calculators/${calculator.id}`} ``), pruny skips it before any further analysis. The runtime value of the interpolated expression is unknown at static analysis time, so any route validation would be a false positive. This is the primary guard. The older `normalizePath` collapse (`${...}` → `[id]`) and the `[id]`-placeholder permissive matching in `matchSegments` remain as a secondary safety net for paths where the `${}` was already stripped by the regex (e.g., a backtick string captured without the interpolation characters) but should rarely trigger after this fix.
- **Multi-tenant route matching**: `matchesDynamicSuffix()` recognizes that `/view_seat` is valid when a route like `/tenant/[domain]/view_seat` exists. The tail (matched portion) must contain at least one literal segment — fully-dynamic tails like `[token]` are rejected to prevent false matches against arbitrary single-segment paths. Users can also manually suppress false positives via `ignore.links` in config.
- **Runtime-generated public assets**: `isRuntimeGeneratedPublicAsset()` whitelists common build-time/runtime files (`sitemap.xml`, `sitemap-*.xml`, `robots.txt`, `manifest.json/webmanifest`, `favicon.ico`, `sw.js`, `service-worker.js`) and any `/sitemap*` link when `next-sitemap.config.{js,mjs,cjs,ts}` exists or when Next.js Metadata Files (`app/sitemap.{ts,tsx,js,jsx}`) are present. These files don't exist in `public/` at scan time but are valid at request time.
- **Summary visibility**: The summary table always shows an "Internal Links" row when the scanner finds links to check, displaying Total/Valid/Broken counts so users can see the feature is active even when there are 0 broken links.

## Config & filtering

- **Config `ignore.links`**: Separate from `ignore.routes` — `routes` is for API endpoints, `links` is for page-level broken-link suppression. Both are checked when filtering broken links (backward compatible).
- **`ignore.files` semantics**: Files matching `config.ignore.files` are excluded from the candidate pool (never reported as unused files or flagged for their exports) but remain in the scan graph for **reachability tracing**. The unused-files scanner adds them as implicit entry points so their imports are traced — otherwise a lib file imported only from an ignored UI wrapper or server action would be wrongly flagged. The unused-exports scanner keeps them in `referenceFiles` for the same reason. Changing this semantic breaks setups where users put UI/component folders under `ignore.files` to suppress noise while those folders still legitimately import shared utilities.

## Path & alias resolution

- **JSONC parser for tsconfig**: `readTsConfigWithExtends()` in `utils.ts` strips `//` and `/* */` comments before `JSON.parse`. The stripper is string-literal-aware — it matches full string literals as the first regex alternative and returns them unchanged, so tsconfig entries like `"@/*": ["./*"]` (which contain `/*` and `*/` sequences inside strings) are preserved. A naive non-aware stripper would corrupt the JSON and silently fall back to an empty alias map, breaking reachability for all `@/`-aliased imports beyond the root-level fallback.

## External-route detection

- **GitHub Actions workflow scanning**: `getGitHubWorkflowPaths()` in `scanner.ts` scans `.github/workflows/*.{yml,yaml}` for `/api/...` references (curl commands, fetch calls, plugin configs). Routes found are marked as used with `.github/workflows` in references. In monorepos, both the app dir and repo root are checked for workflow files.
- **External route auto-detection**: `getAutoDetectedExternalRoutes()` checks `package.json` dependencies for known libraries that create external routes (next-auth → `/api/auth/**`, inngest → `/api/inngest`). These are marked as used with `(auto-detected external)` in references.

## Unused exports: edge cases

- **`lazy()` + dynamic import false positive**: When a file uses `React.lazy(() => import('./tab').then(mod => ({ default: mod.TabName })))`, it declares a local `const TabName = lazy(...)`. The `hasSelfDecl` check sees `const TabName =` and — because there is no static `import { TabName }` — treats the page file as an independent re-declaration and skips it. The actual reference `mod.TabName` is never seen, so `TabName` is wrongly flagged as unused. **Fix**: before skipping, also check for `hasDynamicImportRef` — if the file contains both `import(` and `.TabName` (a property access on the module), it is a consumer, not a re-declaration. See `scanners/unused-exports.ts` around the `hasSelfDecl && !hasSelfImport` guard.

## Framework specifics

- **Framework entry-point exports**: `IGNORED_EXPORT_NAMES` in `constants.ts` includes `middleware` and `proxy` — Next.js framework entry points invoked by the runtime, not imported by user code. `proxy.ts` is the Next.js 16 replacement for `middleware.ts`. The unused-files scanner also treats both as entry points in its glob patterns.
- **Expo / React Native support**: `detectAppFramework()` in `utils.ts` reads an app's `package.json` to identify Expo/RN apps. The unused-files scanner adds Expo Router entry patterns (`_layout.tsx`, all `app/` files) when Expo is detected, so RN files aren't falsely flagged as unused. The broken-links scanner excludes source files from Expo/RN apps in monorepos to prevent Expo Router navigation patterns (e.g., `/(tabs)/home`) from being flagged as broken Next.js page links.

## NestJS

- **NestJS route usage source filtering**: `ApiReference` has a `source` field: `'http-client'` (fetch, axios, useSWR, `/api/` strings, `API_URL` env-var templates) or `'generic'` (plain string literals). In `checkRouteUsage()`, NestJS routes are only matched against `http-client` references. This prevents page navigation paths like `router.push("/super_admin/admin")` from falsely matching NestJS API route `/super_admin`. Next.js routes still match against all references (both sources) since Next.js API routes use the `/api/` prefix which is always `http-client`.
- **Empty NestJS controller detection**: `extractNestRoutes()` creates a placeholder route (with empty `methods` array) for controllers that have `@Controller()` but zero `@Get/@Post/@Put/@Delete` decorators. These appear as unused routes with no HTTP methods, flagging dead controller files.
- **NestJS migration false-positive prevention**: When a NestJS route like `/auth/login` has an `/api` prefix variation (`/api/auth/login`), and a real Next.js route exists at that path in another monorepo app, references to `/api/auth/login` are attributed to the Next.js route — not the NestJS one. After initial usage marking, a post-pass in `scan()` checks each "used" NestJS route: if a matching Next.js API route exists and no references point to the NestJS path directly (without `/api` prefix), the NestJS route is de-marked as unused. This correctly detects migrated-but-not-yet-deleted NestJS endpoints.
