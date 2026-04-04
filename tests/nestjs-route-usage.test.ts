import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scan } from '../src/scanner.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for NestJS route usage false positives:
 *
 * Bug: Page navigation paths like router.push("/super_admin/admin") were falsely
 * matching NestJS API route "/super_admin", causing pruny to report the API route
 * as "used" when it was actually unused.
 *
 * Fix: Added `source` field to ApiReference ('http-client' vs 'generic').
 * NestJS routes are only marked as used by 'http-client' references.
 */

function makeFixture(name: string) {
  const dir = join(import.meta.dir, `fixtures/nestjs-${name}`);
  return {
    dir,
    config(overrides?: Partial<Config>): Config {
      return {
        dir,
        ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        ...overrides,
      };
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('NestJS route usage: page paths should not match API routes', () => {
  const fixture = makeFixture('page-false-positive');

  beforeAll(() => {
    mkdirSync(join(fixture.dir, 'src/super_admin'), { recursive: true });
    mkdirSync(join(fixture.dir, 'src/pages'), { recursive: true });

    writeFileSync(
      join(fixture.dir, 'src/super_admin/super_admin.controller.ts'),
      `import { Controller, Post, Get, Delete, Param } from '@nestjs/common';

@Controller('super_admin')
export class SuperAdminController {
  @Post()
  create() { return 'created'; }

  @Get()
  findAll() { return []; }

  @Get(':id')
  findOne(@Param('id') id: string) { return id; }

  @Delete(':id')
  remove(@Param('id') id: string) { return id; }
}
`
    );

    writeFileSync(
      join(fixture.dir, 'src/pages/dashboard.tsx'),
      `import { useRouter } from 'next/navigation';
export default function Dashboard() {
  const router = useRouter();
  router.push("/super_admin/admin");
  router.push("/super_admin/all");
  return <div>Dashboard</div>;
}
`
    );

    writeFileSync(join(fixture.dir, 'package.json'), JSON.stringify({
      dependencies: { '@nestjs/common': '^10.0.0' },
    }));
  });

  afterAll(() => fixture.cleanup());

  it('should NOT mark NestJS /super_admin as used when only page paths reference it', async () => {
    const result = await scan(fixture.config());
    const route = result.routes.find(r => r.path === '/super_admin' && r.type === 'nestjs');
    expect(route).toBeDefined();
    expect(route!.used).toBe(false);
  });

  it('should NOT mark NestJS /super_admin/:id as used from page navigation', async () => {
    const result = await scan(fixture.config());
    const route = result.routes.find(r => r.path === '/super_admin/:id' && r.type === 'nestjs');
    expect(route).toBeDefined();
    expect(route!.used).toBe(false);
  });
});

describe('NestJS route usage: HTTP client calls should match API routes', () => {
  const fixture = makeFixture('http-client-match');

  beforeAll(() => {
    mkdirSync(join(fixture.dir, 'src/auth'), { recursive: true });
    mkdirSync(join(fixture.dir, 'src/pages'), { recursive: true });

    writeFileSync(
      join(fixture.dir, 'src/auth/auth.controller.ts'),
      `import { Controller, Post, Get } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  @Post('login')
  login() { return 'ok'; }

  @Get('verify/:phone/:otp')
  verify() { return 'ok'; }
}
`
    );

    writeFileSync(
      join(fixture.dir, 'src/pages/login.tsx'),
      `
const endpoint = \`\${process.env.NEXT_PUBLIC_API_URL}/auth/login\`;
const res = await axios.post(endpoint, data);
const verifyRes = await fetch('/auth/verify/1234/5678');
`
    );

    writeFileSync(join(fixture.dir, 'package.json'), JSON.stringify({
      dependencies: { '@nestjs/common': '^10.0.0' },
    }));
  });

  afterAll(() => fixture.cleanup());

  it('should mark NestJS /auth/login as used when called via API_URL env var', async () => {
    const result = await scan(fixture.config());
    const route = result.routes.find(r => r.path === '/auth/login');
    expect(route).toBeDefined();
    expect(route!.used).toBe(true);
  });

  it('should mark NestJS /auth/verify/:phone/:otp as used when called via fetch', async () => {
    const result = await scan(fixture.config());
    const route = result.routes.find(r => r.path.includes('/auth/verify'));
    expect(route).toBeDefined();
    expect(route!.used).toBe(true);
  });
});

describe('NestJS empty controllers should be flagged', () => {
  const fixture = makeFixture('empty-controller');

  beforeAll(() => {
    mkdirSync(join(fixture.dir, 'src/empty'), { recursive: true });

    writeFileSync(
      join(fixture.dir, 'src/empty/empty.controller.ts'),
      `import { Controller } from '@nestjs/common';

@Controller('empty_module')
export class EmptyController {
  // No HTTP method decorators
}
`
    );

    writeFileSync(join(fixture.dir, 'package.json'), JSON.stringify({
      dependencies: { '@nestjs/common': '^10.0.0' },
    }));
  });

  afterAll(() => fixture.cleanup());

  it('should detect empty controller as an unused route', async () => {
    const result = await scan(fixture.config());
    const route = result.routes.find(r => r.path.includes('/empty_module'));
    expect(route).toBeDefined();
    expect(route!.used).toBe(false);
    expect(route!.methods.length).toBe(0);
  });

  it('empty controller route should have no methods defined', async () => {
    const result = await scan(fixture.config());
    const route = result.routes.find(r => r.path.includes('/empty_module'));
    expect(route).toBeDefined();
    expect(route!.methods).toEqual([]);
    expect(route!.unusedMethods).toEqual([]);
  });
});
