import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanBrokenLinks } from '../src/scanners/broken-links.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for:
 * Issue #13: Detect broken internal route links (missing pages/routes)
 * Issue #16: False positive broken links for dynamic tenant subdomain routes
 */

const fixtureBase = join(import.meta.dir, 'fixtures/broken-links-test');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

beforeAll(() => {
  // Create page routes
  mkdirSync(join(fixtureBase, 'app/about'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/dashboard'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/users/[id]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/docs/[...slug]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/(marketing)/pricing'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/tenant/[domain]/view_seat'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/tenant/[domain]/review'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/firm/[slug]/onboarding/[token]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'src'), { recursive: true });
  mkdirSync(join(fixtureBase, 'public'), { recursive: true });

  // Page files
  writeFileSync(join(fixtureBase, 'app/about/page.tsx'), `export default function About() { return <div>About</div>; }`);
  writeFileSync(join(fixtureBase, 'app/dashboard/page.tsx'), `export default function Dashboard() { return <div>Dashboard</div>; }`);
  writeFileSync(join(fixtureBase, 'app/users/[id]/page.tsx'), `export default function UserPage() { return <div>User</div>; }`);
  writeFileSync(join(fixtureBase, 'app/docs/[...slug]/page.tsx'), `export default function Docs() { return <div>Docs</div>; }`);
  writeFileSync(join(fixtureBase, 'app/(marketing)/pricing/page.tsx'), `export default function Pricing() { return <div>Pricing</div>; }`);
  writeFileSync(join(fixtureBase, 'app/tenant/[domain]/view_seat/page.tsx'), `export default function ViewSeat() { return <div>Seat</div>; }`);
  writeFileSync(join(fixtureBase, 'app/tenant/[domain]/review/page.tsx'), `export default function Review() { return <div>Review</div>; }`);
  writeFileSync(join(fixtureBase, 'app/firm/[slug]/onboarding/[token]/page.tsx'), `export default function Onboarding() { return <div>Onboarding</div>; }`);

  // Source file with various link types
  writeFileSync(join(fixtureBase, 'src/navbar.tsx'), `
import Link from 'next/link';

export function Navbar() {
  return (
    <nav>
      <Link href="/about">About</Link>
      <Link href="/pricing">Pricing</Link>
      <Link href="/signup">Sign Up</Link>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/nonexistent">Missing</Link>
      <a href="/also-missing">Also Missing</a>
    </nav>
  );
}
`);

  // Source file with router.push and redirect
  writeFileSync(join(fixtureBase, 'src/actions.ts'), `
import { redirect } from 'next/navigation';

export function goToSettings() {
  router.push("/dashboard/settings");
}

export function goToAbout() {
  redirect("/about");
}

export function goToMissing() {
  redirect("/missing-page");
}
`);

  // Source file with dynamic route references
  writeFileSync(join(fixtureBase, 'src/dynamic.tsx'), `
import Link from 'next/link';

export function Dynamic() {
  return (
    <div>
      <Link href="/users/123">User Profile</Link>
      <Link href="/docs/getting-started/intro">Docs</Link>
    </div>
  );
}
`);

  // Source file with tenant/subdomain links (Issue #16)
  writeFileSync(join(fixtureBase, 'src/tenant-nav.tsx'), `
import Link from 'next/link';

export function TenantNav() {
  return (
    <nav>
      <Link href="/view_seat">View Seat</Link>
      <Link href="/review">Review</Link>
    </nav>
  );
}
`);

  // Source file with navigation config objects
  writeFileSync(join(fixtureBase, 'src/nav-config.ts'), `
export const navItems = [
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/careers", label: "Careers" },
];
`);

  // Issue #25: array-mapped links with broken href + route with fully-dynamic tail
  // This tests that matchesDynamicSuffix doesn't false-match against routes
  // like firm/[slug]/onboarding/[token] where the tail is entirely dynamic.
  writeFileSync(join(fixtureBase, 'src/footer.tsx'), `
import Link from 'next/link';

const solutionLinks = [
  { href: "/about", label: "About Us" },
  { href: "/for-chartered-accountants-2", label: "For CAs" },
  { href: "/nonexistent-page", label: "Missing" },
];

export function Footer() {
  return (
    <footer>
      {solutionLinks.map((item) => (
        <Link href={item.href} key={item.label}>{item.label}</Link>
      ))}
    </footer>
  );
}
`);

  // Source file with API routes (should be skipped)
  writeFileSync(join(fixtureBase, 'src/api-calls.ts'), `
fetch("/api/users");
const url = "/api/health";
`);

  // Source file with external links (should be skipped)
  writeFileSync(join(fixtureBase, 'src/external.tsx'), `
import Link from 'next/link';
export function External() {
  return <a href="https://google.com">Google</a>;
}
`);

  // Source file with pathname comparison
  writeFileSync(join(fixtureBase, 'src/path-check.ts'), `
const isSettings = pathname === "/settings-page";
const isAbout = pathname === "/about";
`);

  // Issue #36: Public static files should not be flagged as broken links
  writeFileSync(join(fixtureBase, 'public/sitemap.xml'), '<urlset></urlset>');
  writeFileSync(join(fixtureBase, 'public/robots.txt'), 'User-agent: *');
  writeFileSync(join(fixtureBase, 'public/manifest.json'), '{}');

  writeFileSync(join(fixtureBase, 'src/public-links.tsx'), `
import Link from 'next/link';

export function Footer() {
  return (
    <footer>
      <a href="/sitemap.xml">Sitemap</a>
      <a href="/robots.txt">Robots</a>
      <a href="/manifest.json">Manifest</a>
      <a href="/nonexistent-file.pdf">Missing File</a>
    </footer>
  );
}
`);
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('Issue #13: broken internal link detection', () => {
  it('should detect broken links to non-existent pages', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const signupLink = result.links.find(l => l.path === '/signup');
    const nonexistentLink = result.links.find(l => l.path === '/nonexistent');

    expect(signupLink).toBeDefined();
    expect(nonexistentLink).toBeDefined();
  });

  it('should NOT flag links to existing pages', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const aboutLink = result.links.find(l => l.path === '/about');
    const dashboardLink = result.links.find(l => l.path === '/dashboard');

    expect(aboutLink).toBeUndefined();
    expect(dashboardLink).toBeUndefined();
  });

  it('should detect broken links from router.push', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const settingsLink = result.links.find(l => l.path === '/dashboard/settings');

    expect(settingsLink).toBeDefined();
  });

  it('should detect broken links from redirect()', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const missingLink = result.links.find(l => l.path === '/missing-page');

    expect(missingLink).toBeDefined();
  });

  it('should NOT flag redirect to existing page', async () => {
    const result = await scanBrokenLinks(makeConfig());
    // /about exists and is redirected to — should NOT be broken
    const aboutLink = result.links.find(l => l.path === '/about');
    expect(aboutLink).toBeUndefined();
  });

  it('should detect broken links from href: config objects', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const careersLink = result.links.find(l => l.path === '/careers');

    expect(careersLink).toBeDefined();
  });

  it('should detect broken links from <a> tags', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const alsoMissing = result.links.find(l => l.path === '/also-missing');

    expect(alsoMissing).toBeDefined();
  });

  it('should detect broken links from pathname comparisons', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const settingsPage = result.links.find(l => l.path === '/settings-page');

    expect(settingsPage).toBeDefined();
  });

  it('should skip API routes', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const apiUsers = result.links.find(l => l.path === '/api/users');
    const apiHealth = result.links.find(l => l.path === '/api/health');

    expect(apiUsers).toBeUndefined();
    expect(apiHealth).toBeUndefined();
  });

  it('should handle dynamic segments [id] — no false positive', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const userLink = result.links.find(l => l.path === '/users/123');

    expect(userLink).toBeUndefined(); // /users/123 matches /users/[id]
  });

  it('should handle catch-all [...slug] — no false positive', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const docsLink = result.links.find(l => l.path === '/docs/getting-started/intro');

    expect(docsLink).toBeUndefined(); // matches /docs/[...slug]
  });

  it('should handle route groups — /pricing maps to (marketing)/pricing', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const pricingLink = result.links.find(l => l.path === '/pricing');

    expect(pricingLink).toBeUndefined(); // exists via route group
  });

  it('should include file references with line numbers', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const signupLink = result.links.find(l => l.path === '/signup');

    expect(signupLink).toBeDefined();
    expect(signupLink!.references.length).toBeGreaterThan(0);
    // References should include file path and line number
    expect(signupLink!.references[0]).toMatch(/:\d+$/);
  });

  it('should return total count of broken links', async () => {
    const result = await scanBrokenLinks(makeConfig());
    expect(result.total).toBe(result.links.length);
    expect(result.total).toBeGreaterThan(0);
  });
});

describe('Issue #16: multi-tenant subdomain routing', () => {
  it('should NOT flag /view_seat when tenant/[domain]/view_seat exists', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const viewSeatLink = result.links.find(l => l.path === '/view_seat');

    expect(viewSeatLink).toBeUndefined(); // resolves via dynamic suffix matching
  });

  it('should NOT flag /review when tenant/[domain]/review exists', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const reviewLink = result.links.find(l => l.path === '/review');

    expect(reviewLink).toBeUndefined();
  });
});

describe('Issue #16: ignore.links config', () => {
  it('should suppress broken links listed in ignore.links', async () => {
    const result = await scanBrokenLinks(makeConfig({
      ignore: {
        routes: [],
        folders: ['**/node_modules/**'],
        files: [],
        links: ['/signup', '/careers'],
      },
    }));

    const signupLink = result.links.find(l => l.path === '/signup');
    const careersLink = result.links.find(l => l.path === '/careers');

    expect(signupLink).toBeUndefined();
    expect(careersLink).toBeUndefined();
  });

  it('should suppress broken links matching wildcard in ignore.links', async () => {
    const result = await scanBrokenLinks(makeConfig({
      ignore: {
        routes: [],
        folders: ['**/node_modules/**'],
        files: [],
        links: ['/dashboard/*'],
      },
    }));

    const settingsLink = result.links.find(l => l.path === '/dashboard/settings');
    expect(settingsLink).toBeUndefined();
  });
});

describe('Issue #25: matchesDynamicSuffix false positive with fully-dynamic tail', () => {
  it('should detect broken link that was falsely matched by dynamic suffix', async () => {
    // /for-chartered-accountants-2 does NOT exist as a route.
    // Bug: matchesDynamicSuffix incorrectly matched it against firm/[slug]/onboarding/[token]
    // because the tail [token] is entirely dynamic and matched any single-segment path.
    const result = await scanBrokenLinks(makeConfig());
    const brokenLink = result.links.find(l => l.path === '/for-chartered-accountants-2');

    expect(brokenLink).toBeDefined();
    expect(brokenLink!.references.length).toBeGreaterThan(0);
  });

  it('should detect all broken links from array-mapped href objects', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const nonexistent = result.links.find(l => l.path === '/nonexistent-page');

    expect(nonexistent).toBeDefined();
  });

  it('should NOT flag valid links from the same array', async () => {
    const result = await scanBrokenLinks(makeConfig());
    // /about exists and is in the footer array — should NOT be broken
    const aboutLink = result.links.find(l => l.path === '/about');

    expect(aboutLink).toBeUndefined();
  });

  it('should still allow valid dynamic suffix matches (multi-tenant)', async () => {
    // /view_seat should still match /tenant/[domain]/view_seat
    // because the tail has a literal segment (view_seat)
    const result = await scanBrokenLinks(makeConfig());
    const viewSeat = result.links.find(l => l.path === '/view_seat');

    expect(viewSeat).toBeUndefined();
  });

  it('should track total scanned links count', async () => {
    const result = await scanBrokenLinks(makeConfig());

    expect(result.scanned).toBeGreaterThan(0);
    expect(result.scanned).toBeGreaterThan(result.total);
  });
});

describe('Issue #36: public static files should not be flagged as broken links', () => {
  it('should NOT flag /sitemap.xml when it exists in public/', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const sitemapLink = result.links.find(l => l.path === '/sitemap.xml');

    expect(sitemapLink).toBeUndefined();
  });

  it('should NOT flag /robots.txt when it exists in public/', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const robotsLink = result.links.find(l => l.path === '/robots.txt');

    expect(robotsLink).toBeUndefined();
  });

  it('should NOT flag /manifest.json when it exists in public/', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const manifestLink = result.links.find(l => l.path === '/manifest.json');

    expect(manifestLink).toBeUndefined();
  });

  it('should still flag links to files that do NOT exist in public/', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const missingFile = result.links.find(l => l.path === '/nonexistent-file.pdf');

    expect(missingFile).toBeDefined();
  });
});
