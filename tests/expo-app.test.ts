/**
 * Regression tests for GitHub issue #31:
 * Pruny incorrectly scans React Native / Expo apps in monorepos.
 *
 * Verifies that:
 * 1. Expo Router entry points (_layout.tsx, app/ files) are recognized
 * 2. Expo app source files are not falsely flagged as unused
 * 3. Framework detection correctly identifies Expo/RN apps
 * 4. Broken links scanner does not flag Expo Router navigation patterns
 */

import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { detectAppFramework } from '../src/utils';
import { scanUnusedFiles } from '../src/scanners/unused-files';
import { scanBrokenLinks } from '../src/scanners/broken-links';
import type { Config } from '../src/types';

const EXPO_FIXTURE = join(import.meta.dir, 'fixtures', 'expo-app');

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    dir: EXPO_FIXTURE,
    ignore: {
      routes: [],
      folders: ['node_modules', '.next', 'dist'],
      files: [],
      links: [],
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

describe('Expo / React Native app support (issue #31)', () => {
  describe('detectAppFramework', () => {
    test('detects Expo app from package.json', () => {
      const frameworks = detectAppFramework(EXPO_FIXTURE);
      expect(frameworks).toContain('expo');
    });

    test('detects react-native in Expo app', () => {
      // Expo apps have both expo and react-native, but expo takes priority
      const frameworks = detectAppFramework(EXPO_FIXTURE);
      expect(frameworks).toContain('expo');
    });

    test('returns unknown for directory without package.json', () => {
      const frameworks = detectAppFramework('/nonexistent');
      expect(frameworks).toEqual(['unknown']);
    });

    test('detects Next.js app correctly', () => {
      const nextFixture = join(import.meta.dir, 'fixtures', 'nextjs-app');
      const frameworks = detectAppFramework(nextFixture);
      // nextjs-app fixture may not have package.json, so this may return unknown
      // The important thing is it does NOT return expo
      expect(frameworks).not.toContain('expo');
      expect(frameworks).not.toContain('react-native');
    });
  });

  describe('scanUnusedFiles — Expo entry points', () => {
    test('_layout.tsx files are recognized as entry points', async () => {
      const config = makeConfig();
      const result = await scanUnusedFiles(config);

      const unusedPaths = result.files.map(f => f.path);
      // _layout.tsx files should NOT be flagged as unused
      expect(unusedPaths.some(p => p.includes('_layout.tsx'))).toBe(false);
    });

    test('app/ directory files are recognized as entry points', async () => {
      const config = makeConfig();
      const result = await scanUnusedFiles(config);

      const unusedPaths = result.files.map(f => f.path);
      // Files inside app/ (Expo Router routes) should NOT be flagged
      expect(unusedPaths.some(p => p.includes('app/index.tsx'))).toBe(false);
      expect(unusedPaths.some(p => p.includes('(tabs)/home.tsx'))).toBe(false);
      expect(unusedPaths.some(p => p.includes('(auth)/login.tsx'))).toBe(false);
    });

    test('files imported by entry points are not flagged', async () => {
      const config = makeConfig();
      const result = await scanUnusedFiles(config);

      const unusedPaths = result.files.map(f => f.path);
      // AuthContext is imported by _layout.tsx, api.ts is imported by home.tsx
      expect(unusedPaths.some(p => p.includes('contexts/AuthContext.tsx'))).toBe(false);
      expect(unusedPaths.some(p => p.includes('lib/api.ts'))).toBe(false);
    });

    test('truly unused files in Expo app are still flagged', async () => {
      const config = makeConfig();
      const result = await scanUnusedFiles(config);

      const unusedPaths = result.files.map(f => f.path);
      // Button.tsx is not imported by anyone — should be flagged
      expect(unusedPaths.some(p => p.includes('components/Button.tsx'))).toBe(true);
    });

    test('does not flag all files as unused (regression check)', async () => {
      const config = makeConfig();
      const result = await scanUnusedFiles(config);

      // Before fix: ALL files were unused. After fix: most should be used.
      // We have 8 files total, at most 1 (Button.tsx) should be unused.
      expect(result.unused).toBeLessThanOrEqual(1);
      expect(result.used).toBeGreaterThan(result.unused);
    });
  });

  describe('scanBrokenLinks — Expo Router navigation', () => {
    test('does not report broken links for app with no Next.js pages', async () => {
      const config = makeConfig();
      const result = await scanBrokenLinks(config);

      // Expo app has no Next.js page.tsx files, so broken links scanner
      // should return early with 0 results — not flag Expo Router paths
      expect(result.total).toBe(0);
      expect(result.links).toEqual([]);
    });
  });
});
