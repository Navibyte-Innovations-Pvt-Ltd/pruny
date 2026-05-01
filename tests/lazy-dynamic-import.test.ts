import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedExports } from '../src/scanners/unused-exports.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression test: exports consumed only via React.lazy() + dynamic import
 * should NOT be flagged as unused.
 *
 * Pattern in page.tsx:
 *   const BillingDashboardTab = lazy(() =>
 *     import('./_components/billing-dashboard-tab').then((mod) => ({
 *       default: mod.BillingDashboardTab,
 *     }))
 *   );
 *
 * Root cause: pruny's hasSelfDecl check saw `const BillingDashboardTab =` in
 * page.tsx and (because there was no static import statement) incorrectly
 * classified it as an independent re-declaration and skipped the file.
 * The actual dynamic reference `mod.BillingDashboardTab` was therefore never
 * seen, and the export was reported as unused.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/lazy-dynamic-import-test');

function makeConfig(): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  };
}

beforeAll(() => {
  mkdirSync(join(fixtureBase, 'app/dashboard/_components'), { recursive: true });

  // Tab component — exports a named component consumed via lazy()
  writeFileSync(
    join(fixtureBase, 'app/dashboard/_components/billing-tab.tsx'),
    `"use client";\nexport function BillingTab({ data }: { data: unknown }) {\n  return <div>{JSON.stringify(data)}</div>;\n}\n`
  );

  // Second tab component
  writeFileSync(
    join(fixtureBase, 'app/dashboard/_components/invoices-tab.tsx'),
    `"use client";\nexport function InvoicesTab({ count }: { count: number }) {\n  return <div>{count}</div>;\n}\n`
  );

  // Page that lazy-loads both tab components via mod.Name pattern
  writeFileSync(
    join(fixtureBase, 'app/dashboard/page.tsx'),
    `"use client";
import { lazy, Suspense } from 'react';

const BillingTab = lazy(() =>
  import('./_components/billing-tab').then((mod) => ({
    default: mod.BillingTab,
  }))
);

const InvoicesTab = lazy(() =>
  import('./_components/invoices-tab').then((mod) => ({
    default: mod.InvoicesTab,
  }))
);

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BillingTab data={{}} />
      <InvoicesTab count={0} />
    </Suspense>
  );
}
`
  );
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('lazy() + dynamic import: export usage detection', () => {
  it('should NOT flag BillingTab as unused when consumed via lazy()+mod.BillingTab', async () => {
    const config = makeConfig();
    const result = await scanUnusedExports(config, [], { silent: true });
    const names = result.exports.map((e) => e.name);
    expect(names).not.toContain('BillingTab');
  });

  it('should NOT flag InvoicesTab as unused when consumed via lazy()+mod.InvoicesTab', async () => {
    const config = makeConfig();
    const result = await scanUnusedExports(config, [], { silent: true });
    const names = result.exports.map((e) => e.name);
    expect(names).not.toContain('InvoicesTab');
  });
});
