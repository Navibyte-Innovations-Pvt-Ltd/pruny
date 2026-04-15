import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedFiles } from '../src/scanners/unused-files.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for issue #38 (follow-up to PR #39).
 *
 * Original bug: a lib file reachable only through a chain whose middle hops
 * live under `ignore.files` was reported as unused, because the scanner
 * excluded those hops from the graph entirely and therefore never traced
 * their imports.
 *
 * Fix: files matching `ignore.files` remain in the scan graph as always-used
 * entry points. Their imports are traced so downstream files stay reachable.
 * They themselves are never listed in the unused report.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/ignored-files-reachability');

function makeConfig(dir: string, ignoreFiles: string[]): Config {
  return {
    dir,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: ignoreFiles, links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  };
}

beforeAll(() => {
  mkdirSync(join(fixtureBase, 'app/dashboard/inputs'), { recursive: true });
  mkdirSync(join(fixtureBase, 'components/AppInputFields/actions'), { recursive: true });
  mkdirSync(join(fixtureBase, 'lib'), { recursive: true });

  // Entry: app/dashboard/inputs/page.tsx — imports InputField (which is ignored)
  writeFileSync(
    join(fixtureBase, 'app/dashboard/inputs/page.tsx'),
    `import InputField from '@/components/AppInputFields/InputField';\n` +
    `export default function Page() { return <InputField />; }\n`
  );

  // Ignored wrapper: components/AppInputFields/InputField.tsx
  // Uses plain next/dynamic without magic comments.
  writeFileSync(
    join(fixtureBase, 'components/AppInputFields/InputField.tsx'),
    `import dynamic from 'next/dynamic';\n` +
    `const Editor = dynamic(() => import('./InputEditorJS'));\n` +
    `export default function InputField() { return <Editor />; }\n`
  );

  // Ignored intermediate: components/AppInputFields/InputEditorJS.tsx
  writeFileSync(
    join(fixtureBase, 'components/AppInputFields/InputEditorJS.tsx'),
    `import { generateEditorContent } from './actions/editor.action';\n` +
    `export default function InputEditorJS() { generateEditorContent('x'); return null; }\n`
  );

  // Ignored server action: "use server" file importing gemini via @/ alias
  writeFileSync(
    join(fixtureBase, 'components/AppInputFields/actions/editor.action.ts'),
    `"use server";\n` +
    `import { gemini } from '@/lib/gemini_ai';\n` +
    `export async function generateEditorContent(prompt: string) { return gemini.generateContent(prompt); }\n`
  );

  // Target: lib/gemini_ai.ts — NOT ignored, only reachable via the ignored chain above
  writeFileSync(
    join(fixtureBase, 'lib/gemini_ai.ts'),
    `export const gemini = { generateContent: (p: string) => p };\n`
  );

  // Also add an actually-unused file at the same level so we can confirm the
  // scanner still flags real dead code when `ignore.files` is set.
  writeFileSync(
    join(fixtureBase, 'lib/truly_unused.ts'),
    `export const junk = 42;\n`
  );

  // Minimal tsconfig so the @/ alias resolves. This also exercises the JSONC
  // parser on a path entry whose string literal contains /* and */ sequences.
  writeFileSync(
    join(fixtureBase, 'tsconfig.json'),
    `{\n  "compilerOptions": {\n    "paths": { "@/*": ["./*"] }\n  }\n}\n`
  );
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('Issue #38 follow-up: ignore.files should not break transitive reachability', () => {
  it('should not flag lib/gemini_ai.ts when only reachable through ignored chain', async () => {
    const result = await scanUnusedFiles(makeConfig(fixtureBase, ['components/AppInputFields/**']));
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('lib/gemini_ai.ts');
  });

  it('should still flag genuinely unused files when ignore.files is set', async () => {
    const result = await scanUnusedFiles(makeConfig(fixtureBase, ['components/AppInputFields/**']));
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).toContain('lib/truly_unused.ts');
  });

  it('ignored files should never appear in the unused report', async () => {
    const result = await scanUnusedFiles(makeConfig(fixtureBase, ['components/AppInputFields/**']));
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('components/AppInputFields/InputField.tsx');
    expect(unusedPaths).not.toContain('components/AppInputFields/InputEditorJS.tsx');
    expect(unusedPaths).not.toContain('components/AppInputFields/actions/editor.action.ts');
  });

  it('total/used counts exclude ignored files', async () => {
    const result = await scanUnusedFiles(makeConfig(fixtureBase, ['components/AppInputFields/**']));
    // Candidate files under fixtureBase: page.tsx, lib/gemini_ai.ts, lib/truly_unused.ts = 3
    // (InputField.tsx, InputEditorJS.tsx, editor.action.ts are in ignore.files and must not count)
    expect(result.total).toBe(3);
    expect(result.used + result.unused).toBe(result.total);
  });

  it('control: without ignore.files, the file is already reachable (pre-existing behavior preserved)', async () => {
    const result = await scanUnusedFiles(makeConfig(fixtureBase, []));
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('lib/gemini_ai.ts');
  });
});
