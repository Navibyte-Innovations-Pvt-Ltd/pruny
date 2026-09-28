import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedServices } from '../src/scanners/unused-services.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Pins scanUnusedServices behaviour. The scanner computes the list of files
 * that import a service class once per service, instead of re-reading every
 * file for every method. Usage rules must not change: `this.<prop>.method()`
 * and `this.<prop>?.method()` via a constructor-injected property, a bare
 * `.method(` call in a file that imports the class, internal `this.method()`
 * calls, and no credit from files that never import the class.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/unused-services-test');

function makeConfig(): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  };
}

function write(rel: string, content: string) {
  const full = join(fixtureBase, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

let unused: string[] = [];

beforeAll(async () => {
  rmSync(fixtureBase, { recursive: true, force: true });
  write('src/billing/billing.service.ts', `export class BillingService {
  charge(amount: number) {
    return amount;
  }

  refund(amount: number) {
    return amount;
  }

  preview(amount: number) {
    return amount;
  }

  helperUsedInternally() {
    return 1;
  }

  total() {
    return this.helperUsedInternally();
  }

  neverCalled() {
    return 0;
  }

  calledFromNonImporter() {
    return 0;
  }
}
`);

  write('src/billing/billing.controller.ts', `import { BillingService } from './billing.service';

export class BillingController {
  constructor(private readonly billing: BillingService) {}

  pay() {
    return this.billing.charge(1);
  }

  back() {
    return this.billing?.refund(1);
  }
}
`);

  write('src/billing/billing.util.ts', `import { BillingService } from './billing.service';

export function run(svc: BillingService) {
  return svc.preview(1) + svc.total();
}
`);

  // Calls a same-named method but never imports BillingService
  write('src/other/other.ts', `export function other(x: { calledFromNonImporter(): number }) {
  return x.calledFromNonImporter();
}
`);

  const result = await scanUnusedServices(makeConfig());
  unused = result.methods.map(m => m.name);
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('scanUnusedServices', () => {
  it('counts this.<prop>.method() through an injected property', () => {
    expect(unused).not.toContain('charge');
  });

  it('counts this.<prop>?.method() optional-chain calls', () => {
    expect(unused).not.toContain('refund');
  });

  it('counts direct .method( calls in files importing the class', () => {
    expect(unused).not.toContain('preview');
    expect(unused).not.toContain('total');
  });

  it('counts internal this.method() calls', () => {
    expect(unused).not.toContain('helperUsedInternally');
  });

  it('reports methods nobody calls', () => {
    expect(unused).toContain('neverCalled');
  });

  it('ignores calls from files that never import the service class', () => {
    expect(unused).toContain('calledFromNonImporter');
  });
});
