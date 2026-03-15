import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scan } from '../src/scanner.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for Issue #12:
 * Dry Run contains no data — scan results must be fully populated
 * so the dry-run report has actual data to serialize.
 *
 * The dry-run logic in index.ts reads from ScanResult fields.
 * These tests verify that ScanResult is populated correctly for all categories.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/dry-run-test');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

beforeAll(() => {
  // Create a minimal app with unused routes, files, exports, and broken links
  mkdirSync(join(fixtureBase, 'app/api/unused-endpoint'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/api/used-endpoint'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/about'), { recursive: true });
  mkdirSync(join(fixtureBase, 'src'), { recursive: true });
  mkdirSync(join(fixtureBase, 'public'), { recursive: true });

  // Unused API route
  writeFileSync(join(fixtureBase, 'app/api/unused-endpoint/route.ts'),
    `export async function GET() { return Response.json({}); }\nexport async function POST() { return Response.json({}); }`
  );

  // Used API route
  writeFileSync(join(fixtureBase, 'app/api/used-endpoint/route.ts'),
    `export async function GET() { return Response.json({}); }`
  );

  // Page
  writeFileSync(join(fixtureBase, 'app/about/page.tsx'),
    `export default function About() { return <div>About</div>; }`
  );

  // Source file referencing the used endpoint + broken link
  writeFileSync(join(fixtureBase, 'src/app.tsx'), `
import Link from 'next/link';
export function App() {
  fetch('/api/used-endpoint');
  return <Link href="/nonexistent-page">Click</Link>;
}
`);

  // Unused source file (not imported anywhere)
  writeFileSync(join(fixtureBase, 'src/dead-code.ts'),
    `export function unusedHelper() { return 42; }`
  );

  // Public asset
  writeFileSync(join(fixtureBase, 'public/unused-image.png'), 'fake-image-data');
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('Issue #12: scan result completeness for dry-run', () => {
  it('should return routes array with both used and unused routes', async () => {
    const result = await scan(makeConfig());

    expect(result.routes).toBeDefined();
    expect(result.routes.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);

    const unusedRoute = result.routes.find(r => r.path === '/api/unused-endpoint');
    const usedRoute = result.routes.find(r => r.path === '/api/used-endpoint');

    expect(unusedRoute).toBeDefined();
    expect(unusedRoute!.used).toBe(false);
    expect(unusedRoute!.methods.length).toBeGreaterThan(0);

    expect(usedRoute).toBeDefined();
    expect(usedRoute!.used).toBe(true);
  });

  it('should return unused count > 0 when unused routes exist', async () => {
    const result = await scan(makeConfig());
    expect(result.unused).toBeGreaterThan(0);
  });

  it('should return used count > 0 when used routes exist', async () => {
    const result = await scan(makeConfig());
    expect(result.used).toBeGreaterThan(0);
  });

  it('should populate unusedFiles result', async () => {
    const result = await scan(makeConfig());
    expect(result.unusedFiles).toBeDefined();
    expect(result.unusedFiles!.total).toBeGreaterThanOrEqual(0);
  });

  it('should populate unusedExports result', async () => {
    const result = await scan(makeConfig());
    expect(result.unusedExports).toBeDefined();
    expect(typeof result.unusedExports!.total).toBe('number');
    expect(typeof result.unusedExports!.unused).toBe('number');
  });

  it('should populate brokenLinks result', async () => {
    const result = await scan(makeConfig());
    expect(result.brokenLinks).toBeDefined();
    expect(result.brokenLinks!.total).toBeGreaterThanOrEqual(0);
  });

  it('should populate httpUsage result', async () => {
    const result = await scan(makeConfig());
    expect(result.httpUsage).toBeDefined();
    expect(typeof result.httpUsage!.fetch).toBe('number');
    expect(typeof result.httpUsage!.axios).toBe('number');
  });

  it('should have route objects with all required fields', async () => {
    const result = await scan(makeConfig());
    for (const route of result.routes) {
      expect(route.type).toBeDefined();
      expect(route.path).toBeDefined();
      expect(route.filePath).toBeDefined();
      expect(typeof route.used).toBe('boolean');
      expect(Array.isArray(route.references)).toBe(true);
      expect(Array.isArray(route.methods)).toBe(true);
      expect(Array.isArray(route.unusedMethods)).toBe(true);
      expect(typeof route.methodLines).toBe('object');
    }
  });

  it('should have unused routes with populated methods and unusedMethods', async () => {
    const result = await scan(makeConfig());
    const unusedRoute = result.routes.find(r => !r.used);

    expect(unusedRoute).toBeDefined();
    expect(unusedRoute!.methods.length).toBeGreaterThan(0);
    expect(unusedRoute!.unusedMethods.length).toBeGreaterThan(0);
  });
});
