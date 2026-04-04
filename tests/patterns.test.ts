import { describe, expect, it } from 'bun:test';
import {
  extractApiReferences,
  EXPORTED_METHOD_PATTERN,
  NEST_CONTROLLER_PATTERN,
  NEST_METHOD_PATTERN,
} from '../src/patterns.js';

describe('extractApiReferences', () => {
  it('should detect fetch calls', () => {
    const refs = extractApiReferences(`fetch('/api/users')`);
    expect(refs.some((r) => r.path === '/api/users')).toBe(true);
  });

  it('should detect axios.get with method', () => {
    const refs = extractApiReferences(`axios.get('/api/users')`);
    expect(refs.some((r) => r.path === '/api/users' && r.method === 'GET')).toBe(true);
  });

  it('should detect axios.post with method', () => {
    const refs = extractApiReferences(`axios.post('/api/users')`);
    expect(refs.some((r) => r.path === '/api/users' && r.method === 'POST')).toBe(true);
  });

  it('should detect axios.delete with method', () => {
    const refs = extractApiReferences(`axios.delete('/api/users/1')`);
    expect(refs.some((r) => r.path === '/api/users/1' && r.method === 'DELETE')).toBe(true);
  });

  it('should detect useSWR as GET', () => {
    const refs = extractApiReferences(`useSWR('/api/users')`);
    expect(refs.some((r) => r.path === '/api/users' && r.method === 'GET')).toBe(true);
  });

  it('should detect template literal API paths', () => {
    const refs = extractApiReferences('fetch(`/api/users/${id}`)');
    expect(refs.some((r) => r.path.startsWith('/api/users'))).toBe(true);
  });

  it('should detect string literal API paths', () => {
    const refs = extractApiReferences(`const url = '/api/products/list'`);
    expect(refs.some((r) => r.path === '/api/products/list')).toBe(true);
  });

  it('should deduplicate same path+method', () => {
    const code = `
      axios.get('/api/users');
      axios.get('/api/users');
    `;
    const refs = extractApiReferences(code);
    const userGets = refs.filter((r) => r.path === '/api/users' && r.method === 'GET');
    expect(userGets.length).toBe(1);
  });

  it('should detect /api/ paths inside multiline template literals (XML/HTML builders)', () => {
    const code = `
      sitemaps.push(
        \`  <sitemap>
    <loc>\${baseUrl}/api/tenant-sitemap/\${library.library_url}</loc>
    <lastmod>\${library.updated_at.toISOString()}</lastmod>
  </sitemap>\`
      );
    `;
    const refs = extractApiReferences(code);
    expect(refs.some((r) => r.path.includes('/api/tenant-sitemap'))).toBe(true);
  });

  it('should detect /api/ paths in multiline template with multiple segments', () => {
    const code = `
      const xml = \`
        <url>
          <loc>\${base}/api/library/details/\${id}</loc>
        </url>
      \`;
    `;
    const refs = extractApiReferences(code);
    expect(refs.some((r) => r.path.includes('/api/library/details'))).toBe(true);
  });

  it('should mark fetch/axios references as http-client source', () => {
    const refs = extractApiReferences(`axios.get('/api/users')`);
    const ref = refs.find((r) => r.path === '/api/users');
    expect(ref).toBeDefined();
    expect(ref!.source).toBe('http-client');
  });

  it('should mark generic string references as generic source', () => {
    const refs = extractApiReferences(`router.push("/super_admin/admin")`);
    const ref = refs.find((r) => r.path.includes('/super_admin'));
    expect(ref).toBeDefined();
    expect(ref!.source).toBe('generic');
  });

  it('should mark fetch calls as http-client source', () => {
    const refs = extractApiReferences(`fetch('/auth/login')`);
    const ref = refs.find((r) => r.path === '/auth/login');
    expect(ref).toBeDefined();
    expect(ref!.source).toBe('http-client');
  });

  it('should mark /api/ string literals as http-client source', () => {
    const refs = extractApiReferences(`const url = '/api/tenant-sitemap/test'`);
    const ref = refs.find((r) => r.path.includes('/api/tenant-sitemap'));
    expect(ref).toBeDefined();
    expect(ref!.source).toBe('http-client');
  });

  it('should keep different methods for same path', () => {
    const code = `
      axios.get('/api/users');
      axios.post('/api/users');
    `;
    const refs = extractApiReferences(code);
    expect(refs.some((r) => r.path === '/api/users' && r.method === 'GET')).toBe(true);
    expect(refs.some((r) => r.path === '/api/users' && r.method === 'POST')).toBe(true);
  });
});

describe('EXPORTED_METHOD_PATTERN', () => {
  it('should match export async function GET', () => {
    EXPORTED_METHOD_PATTERN.lastIndex = 0;
    const match = EXPORTED_METHOD_PATTERN.exec('export async function GET() {');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('GET');
  });

  it('should match export const POST', () => {
    EXPORTED_METHOD_PATTERN.lastIndex = 0;
    const match = EXPORTED_METHOD_PATTERN.exec('export const POST = async () => {');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('POST');
  });

  it('should match all HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    for (const method of methods) {
      EXPORTED_METHOD_PATTERN.lastIndex = 0;
      const match = EXPORTED_METHOD_PATTERN.exec(`export async function ${method}() {`);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(method);
    }
  });
});

describe('NEST_CONTROLLER_PATTERN', () => {
  it('should match @Controller with path', () => {
    const match = NEST_CONTROLLER_PATTERN.exec("@Controller('users')");
    expect(match).not.toBeNull();
    expect(match![1]).toBe('users');
  });

  it('should match @Controller with empty path', () => {
    const match = NEST_CONTROLLER_PATTERN.exec('@Controller()');
    expect(match).not.toBeNull();
  });
});

describe('NEST_METHOD_PATTERN', () => {
  it('should match @Get with path', () => {
    NEST_METHOD_PATTERN.lastIndex = 0;
    const match = NEST_METHOD_PATTERN.exec("@Get('profile')");
    expect(match).not.toBeNull();
    expect(match![1]).toBe('Get');
    expect(match![2]).toBe('profile');
  });

  it('should match @Post without path', () => {
    NEST_METHOD_PATTERN.lastIndex = 0;
    const match = NEST_METHOD_PATTERN.exec('@Post()');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('Post');
  });

  it('should match all NestJS decorators', () => {
    const decorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head', 'All'];
    for (const dec of decorators) {
      NEST_METHOD_PATTERN.lastIndex = 0;
      const match = NEST_METHOD_PATTERN.exec(`@${dec}()`);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(dec);
    }
  });
});

describe('extractApiReferences - dedup does not suppress different paths (issue #35)', () => {
  it('should detect fetch() inside non-exported function when other template literals exist nearby', () => {
    // Simulates the real-world scenario from subscriptions.hook.ts:
    // A large file has template literals (e.g. Razorpay options) followed by
    // a fetch() call to a different API path. The dedup logic must not suppress
    // the fetch path just because a prior regex match spans a large character range.
    const content = `
const createSubscription = async () => {
  const options = {
    name: "PracticeStacks",
    description: \`Premium Plan (monthly)\`,
    image: "https://example.com/logo.png",
    handler: async () => {
      const res = await fetch("/api/subscriptions/verify", {
        method: "POST",
      });
    },
  };
};

const changePlan = async (billingPeriod: "MONTHLY" | "YEARLY") => {
  const response = await fetch("/api/subscriptions/change-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ billingPeriod }),
  });
  return response.json();
};
`;
    const refs = extractApiReferences(content);
    expect(refs.some((r) => r.path === '/api/subscriptions/change-plan')).toBe(true);
    expect(refs.some((r) => r.path === '/api/subscriptions/verify')).toBe(true);
  });

  it('should not let a wide multiline template literal match suppress a separate fetch path', () => {
    // A backtick-ending string followed by code with no backticks,
    // then another template literal containing /api/ — the multiline regex
    // could previously span both, creating a huge match that suppresses later paths
    const content = `
const a = someFunc(\`seats\`,
  image: "https://example.com/logo.png",
  handler: async () => {
    const res = await fetch("/api/users/reset", { method: "POST" });
  }
);

const b = async () => {
  const response = await fetch("/api/billing/create", {
    method: "POST",
  });
};
`;
    const refs = extractApiReferences(content);
    expect(refs.some((r) => r.path === '/api/users/reset')).toBe(true);
    expect(refs.some((r) => r.path === '/api/billing/create')).toBe(true);
  });
});
