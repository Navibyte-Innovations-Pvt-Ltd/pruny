import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedExports } from '../src/scanners/unused-exports.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for the token index in scanUnusedExports.
 *
 * The usage check used to test every export against every file (exports × files
 * pairs, ~10M on a 2.7k-file app, 7+ minutes). It now only checks files whose
 * content contains the export name as a whole `\w+` token. These cases pin the
 * behaviour the index must preserve: whole-token matching, names with `$`
 * (not `\w`, so they bypass the index), JSX-only use, `mod.Name` dynamic
 * imports, independent re-declarations, string/comment mentions, and monorepo
 * app isolation.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/exports-token-index-test');

function makeConfig(): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  };
}

function write(rel: string, content: string) {
  const full = join(fixtureBase, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

let unusedNames: string[] = [];
let usedInternallyNames: string[] = [];

beforeAll(async () => {
  rmSync(fixtureBase, { recursive: true, force: true });
  // package.json pins the reference scope to the fixture (findProjectRoot)
  write('package.json', '{"name":"fixture"}');

  write('lib/format.ts', [
    'export function formatDate(d: Date) { return d.toISOString(); }',
    'export function formatDateTime(d: Date) { return d.toISOString(); }',
    'export const $store = { get: () => 1 };',
    'export const $orphan = { get: () => 2 };',
    'export const onlyInString = 1;',
    'export const onlyInComment = 2;',
    'export const internalOnly = 3;',
    'export const usesInternal = Math.max(internalOnly, 1);',
  ].join('\n'));

  // Uses formatDateTime (formatDate is only a substring of it) and $store
  write('app/page.tsx', [
    "import { formatDateTime, $store, usesInternal } from '../lib/format';",
    "import { Badge } from '../components/badge';",
    "const label = 'onlyInString is mentioned here';",
    '// onlyInComment is mentioned here',
    'export default function Page() {',
    '  return <Badge value={formatDateTime(new Date()) + $store.get() + usesInternal} />;',
    '}',
  ].join('\n'));

  // JSX-only consumer is the page above; Badge is only ever used as <Badge />
  write('components/badge.tsx', 'export function Badge({ value }: { value: unknown }) { return <span>{String(value)}</span>; }\n');

  // Independent re-declaration: same name, no import -> not a usage
  write('components/card.tsx', 'export function Card() { return null; }\n');
  write('components/other-card.tsx', [
    'function Card() { return null; }',
    'export function OtherCard() { return Card(); }',
  ].join('\n'));
  write('app/other/page.tsx', [
    "import { OtherCard } from '../../components/other-card';",
    'export default function P() { return OtherCard(); }',
  ].join('\n'));

  // Dynamic import consumer via mod.Name with a same-named local const
  write('components/lazy-panel.tsx', 'export function LazyPanel() { return null; }\n');
  write('app/lazy/page.tsx', [
    "import { lazy } from 'react';",
    "const LazyPanel = lazy(() => import('../../components/lazy-panel').then((mod) => ({ default: mod.LazyPanel })));",
    'export default function P() { return <LazyPanel />; }',
  ].join('\n'));

  // Monorepo isolation: apps/a export referenced only from apps/b
  write('apps/a/src/helper.ts', 'export function crossAppHelper() { return 1; }\n');
  write('apps/b/src/use.ts', [
    'declare const crossAppHelper: () => number;',
    'export const value = crossAppHelper();',
  ].join('\n'));
  write('apps/b/src/consumer.ts', "import { value } from './use';\nconsole.log(value);\n");

  const result = await scanUnusedExports(makeConfig(), [], { silent: true });
  unusedNames = result.exports.map(e => e.name);
  usedInternallyNames = result.exports.filter(e => e.usedInternally).map(e => e.name);
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('scanUnusedExports token index', () => {
  it('matches whole tokens only: formatDate is unused even though formatDateTime is used', () => {
    expect(unusedNames).toContain('formatDate');
    expect(unusedNames).not.toContain('formatDateTime');
  });

  it('handles names containing $ (outside \\w) via full scan without crashing', () => {
    // Known pre-existing limitation: `\\b$name` never matches, so $-prefixed
    // exports are always reported unused. The index must not change that.
    expect(unusedNames).toContain('$orphan');
    expect(unusedNames).toContain('$store');
  });

  it('counts JSX-only usage', () => {
    expect(unusedNames).not.toContain('Badge');
  });

  it('counts mod.Name usage inside a dynamic import', () => {
    expect(unusedNames).not.toContain('LazyPanel');
  });

  it('ignores independent re-declarations of the same name', () => {
    expect(unusedNames).toContain('Card');
    expect(unusedNames).not.toContain('OtherCard');
  });

  it('ignores mentions inside strings', () => {
    expect(unusedNames).toContain('onlyInString');
  });

  it('keeps pre-existing behaviour for comment-only mentions (fast path counts them)', () => {
    expect(unusedNames).not.toContain('onlyInComment');
  });

  it('keeps usedInternally for exports only referenced in their own file', () => {
    expect(usedInternallyNames).toContain('internalOnly');
  });

  it('does not count usage from a different app in the monorepo', () => {
    expect(unusedNames).toContain('crossAppHelper');
  });
});
