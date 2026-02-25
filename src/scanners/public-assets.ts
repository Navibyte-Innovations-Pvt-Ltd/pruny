import fg from 'fast-glob';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../types.js';
import { shouldIgnore } from '../scanner.js';

export interface PublicAsset {
  path: string;        // Absolute path
  relativePath: string; // Path relative to public/ (e.g., 'images/logo.png')
  used: boolean;
  references: string[];
}

export interface PublicScanResult {
  total: number;
  used: number;
  unused: number;
  assets: PublicAsset[];
}

/**
 * Scan for unused assets in public directory
 */
export async function scanPublicAssets(config: Config): Promise<PublicScanResult> {
  const cwd = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const publicDir = join(cwd, 'public');

  if (!existsSync(publicDir)) {
    return { total: 0, used: 0, unused: 0, assets: [] };
  }

  // 1. Find all files in public directory
  const assetFiles = await fg('**/*', {
    cwd: publicDir,
    onlyFiles: true,
    ignore: ['**/*.xml', 'robots.txt', 'robots.ts', 'robots.js', 'sw.js', 'sw.ts', 'llms.txt'],
  });

  if (assetFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, assets: [] };
  }

  // 2. Build asset map and filter by ignore patterns
  const assets: PublicAsset[] = assetFiles
    .map((file) => ({
      path: join(publicDir, file),
      relativePath: '/' + file, // e.g., /images/logo.png
      used: false,
      references: [],
    }))
    .filter((asset) => {
      // Check if it should be ignored (check both folders and files patterns)
      // We prepend 'public' because the user's config usually refers to the root-relative path
      const publicPath = join('public', asset.relativePath.substring(1));
      return !shouldIgnore(publicPath, [...(config.ignore.folders || []), ...(config.ignore.files || [])]);
    });

  // 3. Find all source files to scan (Local App Only)
  const sourceCwd = config.appSpecificScan ? config.appSpecificScan.appDir : cwd;
  const extGlob = `**/*{${config.extensions.join(',')}}`;
  const sourceFiles = await fg(extGlob, {
    cwd: sourceCwd,
    ignore: [...config.ignore.folders, ...config.ignore.files, 'public/**'],
  });

  // 4. Scan source files for references
  for (const file of sourceFiles) {
    const filePath = join(sourceCwd, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      
      for (const asset of assets) {
        if (asset.used) continue; // Optimization: stop checking if already found

        // Check for exact path match (e.g. "/images/logo.png")
        // We match strict usage to avoid false positives
        if (content.includes(asset.relativePath)) {
          asset.used = true;
          asset.references.push(file);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return {
    total: assets.length,
    used: assets.filter((a) => a.used).length,
    unused: assets.filter((a) => !a.used).length,
    assets,
  };
}
