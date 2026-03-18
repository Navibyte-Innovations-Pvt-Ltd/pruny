export interface IgnoreConfig {
  routes: string[];
  folders: string[];
  files: string[];
  links: string[];
}

export interface Config {
  dir: string;
  ignore: IgnoreConfig;
  extensions: string[];
  excludePublic?: boolean;
  /**
   * Specific app scanning context for monorepos
   */
  appSpecificScan?: {
    appDir: string;
    rootDir: string;
  };
  nestGlobalPrefix?: string;
  extraRoutePatterns?: string[];
  /** Specific folder within an app to scan for routes */
  folder?: string;
}

export interface ApiRoute {
  /** Type of route */
  type: 'nextjs' | 'nestjs';
  /** API path like /api/users */
  path: string;
  /** File path like app/api/users/route.ts */
  filePath: string;
  /** Whether the route is used */
  used: boolean;
  /** Files that reference this route */
  references: string[];
  /** Exported methods (GET, POST, etc.) */
  methods: string[];
  /** Unused methods */
  unusedMethods: string[];
  /** Line numbers for exported methods */
  methodLines: { [method: string]: number };
  // Mapping of HTTP method (GET) to TS method name (findAll)
  methodNames?: { [method: string]: string };
}



export interface PublicAsset {
  path: string;
  relativePath: string;
  used: boolean;
  references: string[];
}

export interface SourceAsset {
  path: string;
  relativePath: string;
  used: boolean;
  references: string[];
}

export interface UnusedFile {
  path: string;
  size: number;
}

export interface ScanResult {
  total: number;
  used: number;
  unused: number;
  routes: ApiRoute[];
  publicAssets?: {
    total: number;
    used: number;
    unused: number;
    assets: PublicAsset[];
  };
  unusedSourceAssets?: {
    total: number;
    used: number;
    unused: number;
    assets: SourceAsset[];
  };
  missingAssets?: {
    total: number;
    assets: MissingAsset[];
  };
  brokenLinks?: {
    total: number;
    scanned: number;
    links: BrokenLink[];
  };
  unusedFiles?: {
    total: number;
    used: number;
    unused: number;
    files: UnusedFile[];
  };
  unusedExports?: {
    total: number;
    used: number;
    unused: number;
    exports: UnusedExport[];
  };
  httpUsage?: {
    axios: number;
    fetch: number;
    got: number;
    ky: number;
  };
  unusedServices?: {
    total: number;
    methods: UnusedServiceMethod[];
  };
}

export interface MissingAsset {
  path: string;
  references: string[];
}

export interface BrokenLink {
  path: string;
  references: string[];
}

export interface MissingAssetsResult {
  total: number;
  assets: MissingAsset[];
}

export interface UnusedExport {
  name: string;
  file: string;
  line: number;
  usedInternally: boolean; // Whether the export is used within the same file
}

export interface UnusedServiceMethod {
  name: string;
  file: string;
  line: number;
  serviceClassName: string;
  usedBy: { file: string; type: 'controller' | 'service' | 'module'; line?: number }[];
}

export interface PrunyOptions {
  dir: string;
  fix?: boolean;
  config?: string;
  json?: boolean;
  dryRun?: boolean;
  public?: boolean;
  verbose?: boolean;
  filter?: string;
  ignoreApps?: string;
  app?: string;
  cleanup?: string;
  folder?: string;
  all?: boolean;
}

export interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
  rewrites?: Array<{ source: string; destination: string }>;
  redirects?: Array<{ source: string; destination: string; statusCode?: number }>;
}
