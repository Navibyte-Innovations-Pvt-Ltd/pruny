import { describe, expect, it } from 'bun:test';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';

/**
 * Regression tests for Issue #18:
 * Default ignored folders (node_modules, .next, etc.) not included by default
 */

describe('Issue #18: default ignored folders', () => {
  it('should include node_modules in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/node_modules/**');
  });

  it('should include .next in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.next/**');
  });

  it('should include .git in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.git/**');
  });

  it('should include dist in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/dist/**');
  });

  it('should include .turbo in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.turbo/**');
  });

  it('should include .cache in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.cache/**');
  });

  it('should include coverage in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/coverage/**');
  });

  it('should include build in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/build/**');
  });

  it('should include .vercel in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.vercel/**');
  });

  it('should include .husky in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.husky/**');
  });

  it('should include .swc in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/.swc/**');
  });

  it('should include generated in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/generated/**');
  });

  it('should include storybook-static in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/storybook-static/**');
  });

  it('should include out in default ignore', () => {
    expect(DEFAULT_CONFIG.ignore.folders).toContain('**/out/**');
  });
});

describe('Issue #18: loadConfig merges defaults', () => {
  it('should carry default ignored folders into loaded config', () => {
    const config = loadConfig({ dir: import.meta.dir });
    expect(config.ignore.folders).toContain('**/node_modules/**');
    expect(config.ignore.folders).toContain('**/.next/**');
    expect(config.ignore.folders).toContain('**/.git/**');
  });
});
