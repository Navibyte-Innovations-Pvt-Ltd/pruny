import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedExports } from '../src/scanners/unused-exports.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for Issue #29:
 * proxy.ts (Next.js 16 middleware replacement) should not be flagged as unused export
 */

const fixtureBase = join(import.meta.dir, 'fixtures/proxy-framework-test');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

describe('Issue #29: proxy.ts as Next.js 16 framework file', () => {
  beforeAll(() => {
    mkdirSync(join(fixtureBase, 'app'), { recursive: true });

    // proxy.ts at app root — Next.js 16 convention
    writeFileSync(
      join(fixtureBase, 'proxy.ts'),
      `export function proxy(request: Request) {\n  return request;\n}\n`
    );

    // A regular file that exports something used elsewhere
    writeFileSync(
      join(fixtureBase, 'app/page.tsx'),
      `export default function Home() { return <div>Home</div>; }\n`
    );

    writeFileSync(join(fixtureBase, 'package.json'), JSON.stringify({
      dependencies: { next: '^16.0.0' },
    }));
  });

  afterAll(() => {
    rmSync(fixtureBase, { recursive: true, force: true });
  });

  it('should NOT flag proxy export from proxy.ts as unused', async () => {
    const result = await scanUnusedExports(makeConfig(), [], { silent: true });
    const proxyExport = result.exports.find(e => e.name === 'proxy');
    expect(proxyExport).toBeUndefined();
  });

  it('should NOT flag proxy export from proxy.js files either', async () => {
    // Create a .js variant
    writeFileSync(
      join(fixtureBase, 'proxy.js'),
      `export function proxy(req) { return req; }\n`
    );

    const result = await scanUnusedExports(
      makeConfig({ extensions: ['.ts', '.tsx', '.js', '.jsx'] }),
      [],
      { silent: true }
    );
    const proxyExports = result.exports.filter(e => e.name === 'proxy');
    expect(proxyExports).toHaveLength(0);
  });
});

describe('Issue #29: middleware.ts export also ignored', () => {
  const middlewareFixture = join(import.meta.dir, 'fixtures/middleware-framework-test');

  beforeAll(() => {
    mkdirSync(join(middlewareFixture, 'app'), { recursive: true });

    writeFileSync(
      join(middlewareFixture, 'middleware.ts'),
      `export function middleware(request: Request) {\n  return request;\n}\n`
    );

    writeFileSync(
      join(middlewareFixture, 'app/page.tsx'),
      `export default function Home() { return <div>Home</div>; }\n`
    );

    writeFileSync(join(middlewareFixture, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0' },
    }));
  });

  afterAll(() => {
    rmSync(middlewareFixture, { recursive: true, force: true });
  });

  it('should NOT flag middleware export as unused', async () => {
    const config = makeConfig({ dir: middlewareFixture });
    const result = await scanUnusedExports(config, [], { silent: true });
    const mwExport = result.exports.find(e => e.name === 'middleware');
    expect(mwExport).toBeUndefined();
  });
});
