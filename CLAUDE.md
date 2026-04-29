# CLAUDE.md

Guidance for Claude Code working in this repository.

## What pruny is

Pruny is a TypeScript CLI that finds and removes unused code in Next.js / NestJS projects — unused API routes, broken internal links, controller methods, public assets, source files, named exports, and service methods. Regex-based static analysis (no AST).

## Commands

```bash
bun run build        # build dist/ (main + worker)
bun run dev          # run src/index.ts directly
bun run lint         # eslint
bun run validate     # lint + tsc --noEmit
bun test             # bun:test
pruny --all          # CI mode: scan all apps, exit 1 if issues
```

## Detail docs (read these before non-trivial work)

- **[docs/architecture.md](docs/architecture.md)** — entry point, source modules, scanners, debug flags, conventions
- **[docs/design-decisions.md](docs/design-decisions.md)** — non-obvious behavior, rationale, traps to avoid (regex strategy, monorepo, broken-links matcher, NestJS quirks, etc.)
- **[docs/testing.md](docs/testing.md)** — local iteration without `bun link`, mandatory smoke tests, broken-links scratch fixture, bug-fix policy

## Hard rules

1. **Bug fix → regression test.** Reproduce the bug in `tests/`, add edge cases, run `bun run validate`. See [docs/testing.md](docs/testing.md#bug-fix-policy).
2. **Smoke-test after any scanner change.** Run pruny against both `practice-stack` and `abhyaiska`. See [docs/testing.md](docs/testing.md#mandatory-smoke-tests-after-any-change).
3. **Update detail docs, not CLAUDE.md.** New architecture → `docs/architecture.md`. New design decision / trap → `docs/design-decisions.md`. CLAUDE.md stays small.
