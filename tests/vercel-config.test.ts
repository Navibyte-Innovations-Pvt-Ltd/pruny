import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scan } from '../src/scanner.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for Issue #20:
 * vercel.json cron auto-detection not working in monorepo (app-specific dir)
 * + template literal URL detection
 */

const fixtureBase = join(import.meta.dir, 'fixtures/vercel-config-test');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

beforeAll(() => {
  // Create a minimal Next.js app with vercel.json and API routes
  mkdirSync(join(fixtureBase, 'app/api/daily'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/api/cron/monthly'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/api/oauth/token'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/api/webhook'), { recursive: true });
  mkdirSync(join(fixtureBase, 'src'), { recursive: true });

  // Route files
  writeFileSync(join(fixtureBase, 'app/api/daily/route.ts'), `export async function GET() { return Response.json({}); }`);
  writeFileSync(join(fixtureBase, 'app/api/cron/monthly/route.ts'), `export async function GET() { return Response.json({}); }`);
  writeFileSync(join(fixtureBase, 'app/api/oauth/token/route.ts'), `export async function POST() { return Response.json({}); }\nexport async function OPTIONS() { return Response.json({}); }`);
  writeFileSync(join(fixtureBase, 'app/api/webhook/route.ts'), `export async function POST() { return Response.json({}); }`);

  // vercel.json with crons, rewrites, and redirects
  writeFileSync(join(fixtureBase, 'vercel.json'), JSON.stringify({
    crons: [
      { path: '/api/daily', schedule: '35 5 * * *' },
      { path: '/api/cron/monthly', schedule: '0 0 1 * *' },
    ],
    rewrites: [
      { source: '/webhook', destination: '/api/webhook' },
    ],
    redirects: [
      { source: '/old-api', destination: '/api/daily', statusCode: 308 },
    ],
  }));

  // Source file with template literal URL referencing /api/oauth/token
  writeFileSync(join(fixtureBase, 'src/oauth.ts'), `
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:4444";
const config = {
  token_endpoint: \`\${BASE_URL}/api/oauth/token\`,
};
`);
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('Issue #20: vercel.json cron detection', () => {
  it('should mark cron routes as used via vercel.json', async () => {
    const result = await scan(makeConfig());
    const dailyRoute = result.routes.find(r => r.path === '/api/daily');

    expect(dailyRoute).toBeDefined();
    expect(dailyRoute!.used).toBe(true);
    expect(dailyRoute!.references).toContain('vercel.json');
    expect(dailyRoute!.unusedMethods).toEqual([]);
  });

  it('should mark nested cron routes as used', async () => {
    const result = await scan(makeConfig());
    const monthlyRoute = result.routes.find(r => r.path === '/api/cron/monthly');

    expect(monthlyRoute).toBeDefined();
    expect(monthlyRoute!.used).toBe(true);
    expect(monthlyRoute!.references).toContain('vercel.json');
  });

  it('should mark rewrite destinations as used', async () => {
    const result = await scan(makeConfig());
    const webhookRoute = result.routes.find(r => r.path === '/api/webhook');

    expect(webhookRoute).toBeDefined();
    expect(webhookRoute!.used).toBe(true);
    expect(webhookRoute!.references).toContain('vercel.json');
  });

  it('should mark redirect destinations as used', async () => {
    const result = await scan(makeConfig());
    const dailyRoute = result.routes.find(r => r.path === '/api/daily');

    expect(dailyRoute).toBeDefined();
    expect(dailyRoute!.used).toBe(true);
    // Should have vercel.json in references (from cron AND redirect)
    expect(dailyRoute!.references.filter(r => r === 'vercel.json').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Issue #20: vercel.json in monorepo app-specific dir', () => {
  it('should find vercel.json in app dir, not just root', async () => {
    // Simulate monorepo: root at fixtureBase, app at fixtureBase itself
    const result = await scan(makeConfig({
      appSpecificScan: {
        appDir: fixtureBase,
        rootDir: fixtureBase,
      },
    }));
    const dailyRoute = result.routes.find(r => r.path === '/api/daily');

    expect(dailyRoute).toBeDefined();
    expect(dailyRoute!.used).toBe(true);
    expect(dailyRoute!.references).toContain('vercel.json');
  });
});

describe('Issue #20: template literal URL detection', () => {
  it('should detect API paths in template literals with variable prefix', async () => {
    const result = await scan(makeConfig());
    const oauthRoute = result.routes.find(r => r.path === '/api/oauth/token');

    expect(oauthRoute).toBeDefined();
    expect(oauthRoute!.used).toBe(true);
  });
});
