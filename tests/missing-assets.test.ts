import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { scanMissingAssets } from '../src/scanners/missing-assets.js';
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

describe('scanMissingAssets', () => {
  it('should detect genuinely missing assets', async () => {
    const config = makeConfig();
    const result = await scanMissingAssets(config);

    const missingPaths = result.assets.map((a) => a.path);
    expect(missingPaths).toContain('/images/nonexistent.webp');
  });

  it('should skip Next.js metadata convention files (icon, apple-icon, favicon)', async () => {
    const config = makeConfig();
    const result = await scanMissingAssets(config);

    const missingPaths = result.assets.map((a) => a.path);

    // These are Next.js conventions — should NOT be flagged
    expect(missingPaths).not.toContain('/apple-icon.png');
    expect(missingPaths).not.toContain('/icon0.svg');
    expect(missingPaths).not.toContain('/icon1.png');
  });

  it('should skip numbered icon variants (icon0, icon1, icon2)', async () => {
    const config = makeConfig();
    const result = await scanMissingAssets(config);

    const missingPaths = result.assets.map((a) => a.path);
    expect(missingPaths).not.toContain('/icon0.svg');
    expect(missingPaths).not.toContain('/icon1.png');
  });

  it('should not flag assets that exist in public/', async () => {
    const config = makeConfig();
    const result = await scanMissingAssets(config);

    const missingPaths = result.assets.map((a) => a.path);
    // logo.png exists in public/images/ and is referenced in Header.tsx
    expect(missingPaths).not.toContain('/images/logo.png');
  });

  it('should return empty when no public directory exists', async () => {
    const config = makeConfig({ dir: '/tmp/nonexistent-project-pruny' });
    const result = await scanMissingAssets(config);

    expect(result.total).toBe(0);
    expect(result.assets).toEqual([]);
  });

  it('should include referencing file path with line number', async () => {
    const config = makeConfig();
    const result = await scanMissingAssets(config);

    const missing = result.assets.find((a) => a.path === '/images/nonexistent.webp');
    expect(missing).toBeDefined();
    expect(missing!.references.length).toBeGreaterThan(0);
    expect(missing!.references[0]).toMatch(/config\.ts:\d+$/);
  });
});
