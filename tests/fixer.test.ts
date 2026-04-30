import { describe, expect, it } from 'bun:test';
import { deleteDeclaration } from '../src/fixer.js';

describe('deleteDeclaration', () => {
  it('deletes a full array-of-objects export without orphaning remaining items', () => {
    const lines = [
      'export const contactMethods = [',
      '    {',
      '        icon: Phone,',
      '        title: "Call Us",',
      '    },',
      '    {',
      '        icon: Mail,',
      '        title: "Fill the Form",',
      '    },',
      '    {',
      '        icon: MapPin,',
      '        title: "Visit Our Office",',
      '    },',
      ']',
      '',
      'export const other = 1;',
    ];

    const deleted = deleteDeclaration(lines, 0, 'contactMethods');
    expect(deleted).toBeGreaterThan(0);
    // Entire array should be gone, `other` must survive
    const joined = lines.join('\n');
    expect(joined).not.toContain('contactMethods');
    expect(joined).not.toContain('Call Us');
    expect(joined).not.toContain('Fill the Form');
    expect(joined).not.toContain('Visit Our Office');
    expect(joined).toContain('export const other = 1;');
  });

  it('deletes a simple object export', () => {
    const lines = [
      'export const config = {',
      '    foo: 1,',
      '    bar: 2,',
      '}',
      '',
      'export const keep = true;',
    ];

    const deleted = deleteDeclaration(lines, 0, 'config');
    expect(deleted).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('config');
    expect(lines.join('\n')).toContain('export const keep = true;');
  });

  it('deletes a function declaration', () => {
    const lines = [
      'export function doThing() {',
      '  return 42;',
      '}',
      '',
      'export const keep = 1;',
    ];

    const deleted = deleteDeclaration(lines, 0, 'doThing');
    expect(deleted).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('doThing');
    expect(lines.join('\n')).toContain('export const keep = 1;');
  });

  it('deletes a flat array export (no nested objects)', () => {
    const lines = [
      'export const items = [',
      '  "one",',
      '  "two",',
      '  "three",',
      ']',
      '',
      'export const keep = 1;',
    ];

    const deleted = deleteDeclaration(lines, 0, 'items');
    expect(deleted).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('items');
    expect(lines.join('\n')).toContain('export const keep = 1;');
  });

  it('deletes a function with multi-line template literal containing ${...}', () => {
    const lines = [
      'export function RelatedContent({ slug }: Props) {',
      '  const items = [',
      '    {',
      '      description: `Free online ${formatTitle(slug)}`,',
      '    },',
      '    {',
      '      className: `rounded-lg ${',
      "        slug === 'foo' ? 'bg-blue-100' : 'bg-green-100'",
      '      }`,',
      '    },',
      '  ]',
      '  return items',
      '}',
      '',
      'export const keep = 1;',
    ];

    const deleted = deleteDeclaration(lines, 0, 'RelatedContent');
    expect(deleted).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('RelatedContent');
    expect(lines.join('\n')).toContain('export const keep = 1;');
  });
});
