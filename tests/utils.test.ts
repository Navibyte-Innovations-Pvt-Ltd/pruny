import { describe, expect, it } from 'bun:test';
import {
  sanitizeLine,
  resolveFilePath,
  getAppName,
  makeCodePattern,
  escapeRegExp,
  matchesFilter,
} from '../src/utils.js';
import type { Config } from '../src/types.js';

describe('sanitizeLine', () => {
  it('should remove single-quoted strings', () => {
    expect(sanitizeLine("const x = 'hello';")).toBe("const x = '';");
  });

  it('should remove double-quoted strings', () => {
    expect(sanitizeLine('const x = "hello";')).toBe('const x = "";');
  });

  it('should remove template literals', () => {
    expect(sanitizeLine('const x = `hello`;')).toBe('const x = ``;');
  });

  it('should remove single-line comments', () => {
    expect(sanitizeLine('const x = 1; // comment')).toBe('const x = 1; ');
  });

  it('should remove inline block comments', () => {
    expect(sanitizeLine('const x = /* comment */ 1;')).toBe('const x =  1;');
  });

  it('should handle escaped characters', () => {
    const result = sanitizeLine("const x = 'it\\'s';");
    expect(result).not.toContain('it');
  });

  it('should preserve braces for counting', () => {
    const result = sanitizeLine('function foo() { return "bar"; }');
    expect(result).toContain('{');
    expect(result).toContain('}');
  });
});

describe('resolveFilePath', () => {
  const config: Config = {
    dir: '/project',
    ignore: { routes: [], folders: [], files: [] },
    extensions: ['.ts'],
  };

  it('should return absolute paths unchanged', () => {
    expect(resolveFilePath('/absolute/path.ts', config)).toBe('/absolute/path.ts');
  });

  it('should resolve relative paths against config dir', () => {
    expect(resolveFilePath('src/file.ts', config)).toBe('/project/src/file.ts');
  });

  it('should use rootDir from appSpecificScan when available', () => {
    const monoConfig: Config = {
      ...config,
      appSpecificScan: { appDir: '/project/apps/web', rootDir: '/project' },
    };
    expect(resolveFilePath('src/file.ts', monoConfig)).toBe('/project/src/file.ts');
  });
});

describe('getAppName', () => {
  it('should extract app name from apps/ path', () => {
    expect(getAppName('apps/my-app/src/foo.ts')).toBe('apps/my-app');
  });

  it('should extract package name from packages/ path', () => {
    expect(getAppName('packages/shared/src/utils.ts')).toBe('packages/shared');
  });

  it('should return Root for non-monorepo paths', () => {
    expect(getAppName('src/index.ts')).toBe('Root');
  });
});

describe('escapeRegExp', () => {
  it('should escape special regex characters', () => {
    expect(escapeRegExp('file.name')).toBe('file\\.name');
    expect(escapeRegExp('a+b')).toBe('a\\+b');
    expect(escapeRegExp('(test)')).toBe('\\(test\\)');
    expect(escapeRegExp('a[0]')).toBe('a\\[0\\]');
  });

  it('should leave alphanumeric characters unchanged', () => {
    expect(escapeRegExp('hello123')).toBe('hello123');
  });
});

describe('makeCodePattern', () => {
  it('should match function calls', () => {
    const pattern = makeCodePattern('myFunction');
    expect(pattern.test('myFunction(')).toBe(true);
    expect(pattern.test('myFunction(arg)')).toBe(true);
  });

  it('should match property access', () => {
    const pattern = makeCodePattern('myProp');
    expect(pattern.test('obj.myProp')).toBe(true);
  });

  it('should match type annotations', () => {
    const pattern = makeCodePattern('MyType');
    expect(pattern.test('const x: MyType')).toBe(true);
  });

  it('should match generic usage', () => {
    const pattern = makeCodePattern('MyType');
    expect(pattern.test('Array<MyType>')).toBe(true);
  });

  it('should not match partial names in different words', () => {
    const pattern = makeCodePattern('use');
    // Should not match 'user' as a standalone word boundary prevents it
    expect(pattern.test('const user = 1')).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('should match exact path segments', () => {
    expect(matchesFilter('src/components/Button.tsx', 'button')).toBe(true);
  });

  it('should match file name without extension', () => {
    expect(matchesFilter('src/utils/helpers.ts', 'helpers')).toBe(true);
  });

  it('should match app name in monorepo paths', () => {
    expect(matchesFilter('apps/web/src/index.ts', 'web')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(matchesFilter('src/Components/Button.tsx', 'button')).toBe(true);
  });

  it('should match partial path', () => {
    expect(matchesFilter('src/components/ui/Dialog.tsx', 'components/ui')).toBe(true);
  });
});
