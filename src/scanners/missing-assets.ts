import fg from 'fast-glob';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Config } from '../types.js';

// Next.js App Router metadata convention file prefixes
// These files in app/ are served at root URLs (e.g., app/icon.png → /icon.png)
const NEXTJS_METADATA_PREFIXES = [
  'icon', 'apple-icon', 'favicon', 'opengraph-image', 'twitter-image',
];

export interface MissingAsset {
  path: string;        // The missing path (e.g., "/images/missing.png")
  references: string[]; // Files that reference this missing asset
}

export interface MissingAssetsResult {
  total: number;
  assets: MissingAsset[];
}

/**
 * Scan for assets referenced in code but missing from public directory
 */
export async function scanMissingAssets(config: Config): Promise<MissingAssetsResult> {
  const cwd = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const publicDir = join(cwd, 'public');

  if (!existsSync(publicDir)) {
    return { total: 0, assets: [] };
  }

  // 1. Find all source files to scan
  const ignore = [...config.ignore.folders, ...config.ignore.files, 'public/**', '**/node_modules/**'];
  const extensions = config.extensions;
  const globPattern = `**/*{${extensions.join(',')}}`;

  const sourceFiles = await fg(globPattern, {
    cwd,
    ignore,
    absolute: true
  });

  const missingMap = new Map<string, Set<string>>(); // path -> Set of referencing files

  // Regex to find potential asset paths: starts with slash, ends with extension
  // Matches: '/img/logo.png', "/assets/icon.svg"
  // Extensions: png, jpg, jpeg, gif, svg, webp, ico, avif, mp4, webm
  const assetRegex = /(?:'|")(\/[^'"]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|avif|mp4|webm))(?:'|")/gi;

  for (const file of sourceFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      let match;
      
      // Reset lastIndex for global regex
      assetRegex.lastIndex = 0;

      while ((match = assetRegex.exec(content)) !== null) {
        const assetPath = match[1]; // e.g. /images/logo.png
        const matchIndex = match.index;
        
        // Calculate line number
        const linesUpToMatch = content.substring(0, matchIndex).split('\n');
        const lineNumber = linesUpToMatch.length;
        
        // Construct full path to check existence
        const fullPath = join(publicDir, assetPath.substring(1)); // Remove leading slash for safer join

        if (!existsSync(fullPath)) {
            // Check if this is a Next.js metadata convention file in app/ directory
            // e.g., /icon0.svg → app/icon0.svg, /apple-icon.png → app/apple-icon.png
            const fileName = basename(assetPath);
            const isNextjsMetadata = NEXTJS_METADATA_PREFIXES.some(prefix =>
              fileName === prefix || fileName.startsWith(`${prefix}.`) || fileName.match(new RegExp(`^${prefix}\\d+\\.`))
            );

            if (isNextjsMetadata) {
              const appPath = join(cwd, 'app', fileName);
              if (existsSync(appPath)) continue;
            }

            // It's missing!
            const assetKey = assetPath;
            if (!missingMap.has(assetKey)) {
                missingMap.set(assetKey, new Set());
            }
            // Store reference with line number
            // We use a string representation "file:line" to ensure uniqueness in Set
            missingMap.get(assetKey)!.add(`${file}:${lineNumber}`);
        }
      }
    } catch (_e) {
      // Ignore read errors
    }
  }

  const assets: MissingAsset[] = [];
  for (const [path, refs] of missingMap.entries()) {
      assets.push({
          path,
          references: Array.from(refs).sort() // Sort for consistent output
      });
  }

  return {
    total: assets.length,
    assets
  };
}
