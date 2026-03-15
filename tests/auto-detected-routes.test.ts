import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scan } from '../src/scanner.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for Issue #18:
 * Auto-detected external routes (next-auth, inngest) should be marked as used
 */

const fixtureBase = join(import.meta.dir, 'fixtures/auto-detect-test');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

describe('Issue #18: next-auth auto-detection', () => {
  beforeAll(() => {
    mkdirSync(join(fixtureBase, 'app/api/auth/[...nextauth]'), { recursive: true });
    writeFileSync(
      join(fixtureBase, 'app/api/auth/[...nextauth]/route.ts'),
      `export { GET, POST } from "@/auth";\nexport async function GET() { return Response.json({}); }\nexport async function POST() { return Response.json({}); }`
    );
    writeFileSync(join(fixtureBase, 'package.json'), JSON.stringify({
      dependencies: { 'next-auth': '^5.0.0', 'next': '^16.0.0' },
    }));
  });

  afterAll(() => {
    rmSync(fixtureBase, { recursive: true, force: true });
  });

  it('should auto-detect next-auth route as used', async () => {
    const result = await scan(makeConfig());
    const authRoute = result.routes.find(r => r.path === '/api/auth/[...nextauth]');

    expect(authRoute).toBeDefined();
    expect(authRoute!.used).toBe(true);
    expect(authRoute!.references).toContain('(auto-detected external)');
    expect(authRoute!.unusedMethods).toEqual([]);
  });
});

describe('Issue #18: inngest auto-detection', () => {
  beforeAll(() => {
    rmSync(fixtureBase, { recursive: true, force: true });
    mkdirSync(join(fixtureBase, 'app/api/inngest'), { recursive: true });
    writeFileSync(
      join(fixtureBase, 'app/api/inngest/route.ts'),
      `export async function POST() { return Response.json({}); }`
    );
    writeFileSync(join(fixtureBase, 'package.json'), JSON.stringify({
      dependencies: { 'inngest': '^3.0.0', 'next': '^16.0.0' },
    }));
  });

  afterAll(() => {
    rmSync(fixtureBase, { recursive: true, force: true });
  });

  it('should auto-detect inngest route as used', async () => {
    const result = await scan(makeConfig());
    const inngestRoute = result.routes.find(r => r.path === '/api/inngest');

    expect(inngestRoute).toBeDefined();
    expect(inngestRoute!.used).toBe(true);
    expect(inngestRoute!.references).toContain('(auto-detected external)');
  });
});

describe('Issue #18: no false auto-detection', () => {
  beforeAll(() => {
    rmSync(fixtureBase, { recursive: true, force: true });
    mkdirSync(join(fixtureBase, 'app/api/custom'), { recursive: true });
    writeFileSync(
      join(fixtureBase, 'app/api/custom/route.ts'),
      `export async function GET() { return Response.json({}); }`
    );
    // No next-auth or inngest in dependencies
    writeFileSync(join(fixtureBase, 'package.json'), JSON.stringify({
      dependencies: { 'next': '^16.0.0' },
    }));
  });

  afterAll(() => {
    rmSync(fixtureBase, { recursive: true, force: true });
  });

  it('should NOT auto-detect routes when no matching dependencies exist', async () => {
    const result = await scan(makeConfig());
    const customRoute = result.routes.find(r => r.path === '/api/custom');

    expect(customRoute).toBeDefined();
    expect(customRoute!.used).toBe(false);
    expect(customRoute!.references).not.toContain('(auto-detected external)');
  });
});
