import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { scanPublicAssets } from '../src/scanners/public-assets.js';
import type { Config } from '../src/types.js';

const FIXTURE_DIR = join(import.meta.dir, 'fixtures/nextjs-app');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: FIXTURE_DIR,
    ignore: { routes: [], folders: [], files: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

describe('scanPublicAssets', () => {
  it('should find all public assets', async () => {
    const config = makeConfig();
    const result = await scanPublicAssets(config);

    // We have logo.png, unused-banner.png, favicon.ico in fixtures
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('should mark referenced assets as used', async () => {
    const config = makeConfig();
    const result = await scanPublicAssets(config);

    const logo = result.assets.find((a) => a.relativePath === '/images/logo.png');
    expect(logo).toBeDefined();
    expect(logo!.used).toBe(true);
  });

  it('should mark unreferenced assets as unused', async () => {
    const config = makeConfig();
    const result = await scanPublicAssets(config);

    const banner = result.assets.find((a) => a.relativePath === '/images/unused-banner.png');
    expect(banner).toBeDefined();
    expect(banner!.used).toBe(false);
  });

  it('should return empty when no public directory exists', async () => {
    const config = makeConfig({ dir: '/tmp/nonexistent-project-pruny' });
    const result = await scanPublicAssets(config);

    expect(result.total).toBe(0);
    expect(result.assets).toEqual([]);
  });

  it('should report correct used/unused counts', async () => {
    const config = makeConfig();
    const result = await scanPublicAssets(config);

    expect(result.used + result.unused).toBe(result.total);
    expect(result.unused).toBeGreaterThanOrEqual(1);
  });
});
