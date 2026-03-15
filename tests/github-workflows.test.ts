import { describe, expect, it } from 'bun:test';
import { scan } from '../src/scanner.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const fixtureDir = join(import.meta.dir, 'fixtures/nextjs-app');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureDir,
    ignore: { routes: [], folders: ['node_modules'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

describe('GitHub Actions workflow scanning', () => {
  it('should mark routes referenced in .github/workflows as used', async () => {
    const result = await scan(makeConfig());
    const healthRoute = result.routes.find(r => r.path === '/api/health');

    expect(healthRoute).toBeDefined();
    expect(healthRoute!.used).toBe(true);
    expect(healthRoute!.references).toContain('.github/workflows');
  });

  it('should mark all methods as used for workflow-referenced routes', async () => {
    const result = await scan(makeConfig());
    const usersRoute = result.routes.find(r => r.path === '/api/users');

    expect(usersRoute).toBeDefined();
    expect(usersRoute!.used).toBe(true);
    expect(usersRoute!.unusedMethods).toEqual([]);
    expect(usersRoute!.references).toContain('.github/workflows');
  });

  it('should detect curl commands in workflow files', async () => {
    const result = await scan(makeConfig());
    const healthRoute = result.routes.find(r => r.path === '/api/health');
    // The fixture uses: curl -X POST "$SITE_URL/api/health"
    expect(healthRoute!.used).toBe(true);
  });

  it('should detect fetch calls in workflow files', async () => {
    const tmpWorkflow = join(fixtureDir, '.github/workflows/deploy.yml');
    writeFileSync(tmpWorkflow, `
name: Deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: node -e "fetch('https://example.com/api/health')"
`);

    try {
      const result = await scan(makeConfig());
      const healthRoute = result.routes.find(r => r.path === '/api/health');
      expect(healthRoute!.used).toBe(true);
    } finally {
      rmSync(tmpWorkflow);
    }
  });

  it('should detect env-variable-prefixed API URLs', async () => {
    const tmpWorkflow = join(fixtureDir, '.github/workflows/notify.yml');
    writeFileSync(tmpWorkflow, `
name: Notify
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: curl "\${APP_URL}/api/users"
`);

    try {
      const result = await scan(makeConfig());
      const usersRoute = result.routes.find(r => r.path === '/api/users');
      expect(usersRoute!.used).toBe(true);
    } finally {
      rmSync(tmpWorkflow);
    }
  });

  it('should handle .yaml extension in addition to .yml', async () => {
    const tmpWorkflow = join(fixtureDir, '.github/workflows/cron.yaml');
    writeFileSync(tmpWorkflow, `
name: Cron
on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -sf "$URL/api/health"
`);

    try {
      const result = await scan(makeConfig());
      const healthRoute = result.routes.find(r => r.path === '/api/health');
      expect(healthRoute!.used).toBe(true);
    } finally {
      rmSync(tmpWorkflow);
    }
  });

  it('should not mark routes that are NOT in workflow files', async () => {
    // Create a temp fixture with an extra route that has zero references anywhere
    const tmpRouteDir = join(fixtureDir, 'app/api/orphan');
    mkdirSync(tmpRouteDir, { recursive: true });
    writeFileSync(join(tmpRouteDir, 'route.ts'), `export async function GET() { return Response.json({}); }`);

    try {
      const result = await scan(makeConfig());
      const orphanRoute = result.routes.find(r => r.path === '/api/orphan');
      expect(orphanRoute).toBeDefined();
      expect(orphanRoute!.used).toBe(false);
      expect(orphanRoute!.references).not.toContain('.github/workflows');
    } finally {
      rmSync(tmpRouteDir, { recursive: true });
    }
  });

  it('should work when no .github/workflows directory exists', async () => {
    // Use a temp dir with no workflows
    const tmpDir = join(import.meta.dir, 'fixtures/nextjs-app-no-workflows');
    const tmpApiDir = join(tmpDir, 'app/api/test');
    mkdirSync(tmpApiDir, { recursive: true });
    writeFileSync(join(tmpApiDir, 'route.ts'), `export async function GET() { return Response.json({}); }`);

    try {
      const result = await scan(makeConfig({ dir: tmpDir }));
      // Should not crash — just no workflow-based marking
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('should detect multiple API paths from a single workflow file', async () => {
    // The release.yml fixture references both /api/health and /api/users
    const result = await scan(makeConfig());
    const healthRoute = result.routes.find(r => r.path === '/api/health');
    const usersRoute = result.routes.find(r => r.path === '/api/users');

    expect(healthRoute!.used).toBe(true);
    expect(usersRoute!.used).toBe(true);
    expect(healthRoute!.references).toContain('.github/workflows');
    expect(usersRoute!.references).toContain('.github/workflows');
  });

  it('should handle paths with dynamic segments in workflows', async () => {
    const tmpWorkflow = join(fixtureDir, '.github/workflows/dynamic.yml');
    const tmpRouteDir = join(fixtureDir, 'app/api/items/[id]');
    mkdirSync(tmpRouteDir, { recursive: true });
    writeFileSync(join(tmpRouteDir, 'route.ts'), `export async function GET() { return Response.json({}); }`);
    writeFileSync(tmpWorkflow, `
name: Dynamic
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: curl "$URL/api/items/[id]"
`);

    try {
      const result = await scan(makeConfig());
      const itemsRoute = result.routes.find(r => r.path === '/api/items/[id]');
      expect(itemsRoute).toBeDefined();
      expect(itemsRoute!.used).toBe(true);
    } finally {
      rmSync(tmpWorkflow);
      rmSync(tmpRouteDir, { recursive: true });
    }
  });
});
