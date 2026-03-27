/**
 * Shared constants used across scanners, workers, and fixers.
 * Single source of truth — avoids duplication across modules.
 */

/** Next.js/React standard exports that shouldn't be marked as unused */
export const IGNORED_EXPORT_NAMES = new Set([
  'config',
  'generateMetadata',
  'generateStaticParams',
  'dynamic',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'metadata',
  'viewport',
  'dynamicParams',
  'maxDuration',
  'generateViewport',
  'generateSitemaps',
  'generateImageMetadata',
  'alt',
  'size',
  'contentType',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  'default',
  // Serverless/Lambda entry points (invoked by runtime, not imported)
  'handler', 'main', 'lambdaHandler',
  // Next.js framework entry points (invoked by framework, not imported)
  'middleware', 'proxy',
]);

/** NestJS/framework decorators that imply the method is called by the framework */
export const FRAMEWORK_METHOD_DECORATORS = new Set([
  '@Cron', '@OnEvent', '@Process', '@MessagePattern', '@EventPattern',
  '@OnWorkerEvent', '@SqsMessageHandler', '@SqsConsumerEventHandler',
  '@Post', '@Get', '@Put', '@Delete', '@Patch', '@Options', '@Head', '@All',
  '@ResolveField', '@Query', '@Mutation', '@Subscription',
  '@Interval', '@Timeout',
]);

/** NestJS lifecycle hooks that should never be treated as unused methods */
export const NEST_LIFECYCLE_METHODS = new Set([
  'constructor', 'onModuleInit', 'onApplicationBootstrap',
  'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown'
]);

/** JavaScript keywords that should never be treated as method/export names */
export const JS_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'with', 'yield', 'await', 'class',
  'function', 'var', 'let', 'const', 'import', 'export', 'default', 'from',
  'super', 'this',
]);

/** Extended invalid method names — includes JS keywords + built-in types + array methods + ORM methods */
export const INVALID_METHOD_NAMES = new Set([
  ...JS_KEYWORDS,
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Promise',
  'forEach', 'map', 'filter', 'reduce', 'find', 'findIndex', 'some', 'every',
  'findUnique', 'findFirst', 'findMany', 'createMany', 'updateMany', 'deleteMany',
]);

/** Generic method names that may collide with ORM/Prisma methods */
export const GENERIC_METHOD_NAMES = new Set([
  'update', 'create', 'delete', 'remove', 'find', 'findOne', 'findAll', 'save', 'count'
]);

/** Default glob ignore patterns for scanning */
export const DEFAULT_IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
  '**/.git/**', '**/.next/**', '**/out/**', '**/.turbo/**', '**/.cache/**',
  '**/.vercel/**', '**/.husky/**', '**/.swc/**', '**/generated/**',
  '**/storybook-static/**',
];

/** Regex to match class method declarations (stateful — use createClassMethodRegex() for fresh instances) */
export const CLASS_METHOD_REGEX = /^\s*(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]*)?\{/gm;

/** Regex to match inline export declarations (stateful — use createInlineExportRegex() for fresh instances) */
export const INLINE_EXPORT_REGEX = /^export\s+(?:async\s+)?(?:const|let|var|function|type|interface|enum|class)\s+([a-zA-Z0-9_$]+)/gm;

/** Regex to match block export declarations (stateful — use createBlockExportRegex() for fresh instances) */
export const BLOCK_EXPORT_REGEX = /^export\s*\{([^}]+)\}/gm;

/** File types that contain NestJS class methods (not just regular exports) */
export function isServiceLikeFile(file: string): boolean {
  return file.endsWith('.service.ts') || file.endsWith('.service.tsx') ||
    file.endsWith('.controller.ts') || file.endsWith('.processor.ts') ||
    file.endsWith('.resolver.ts');
}
