import fg from 'fast-glob';
import { relative } from 'node:path';
import type { Config } from '../types.js';
import { readSourceFile } from '../utils.js';

export interface SourceAsset {
  path: string;        // Absolute path
  relativePath: string; // Path relative to appDir
  used: boolean;
  references: string[];
}

export interface SourceAssetScanResult {
  total: number;
  used: number;
  unused: number;
  assets: SourceAsset[];
}

/**
 * Scan for unused assets in source directories (images, fonts, etc.)
 */
export async function scanSourceAssets(config: Config): Promise<SourceAssetScanResult> {
  const cwd = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const ignore = [...config.ignore.folders, ...config.ignore.files, 'public/**', '**/node_modules/**'];

  // 1. Find all asset files
  const assetExtensions = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'avif', 'mp4', 'webm'];
  const assetGlob = `**/*.{${assetExtensions.join(',')}}`;
  
  const assetFiles = await fg(assetGlob, {
    cwd,
    ignore,
    absolute: true
  });

  if (assetFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, assets: [] };
  }

  // Map absolute path -> Asset object
  const assetMap = new Map<string, SourceAsset>();
  for (const file of assetFiles) {
    assetMap.set(file, {
      path: file,
      relativePath: relative(cwd, file),
      used: false,
      references: []
    });
  }

  // 2. Find all source code files to scan for usage
  const sourceExtensions = config.extensions; // .ts, .tsx, .js, .jsx
  const sourceGlob = `**/*{${sourceExtensions.join(',')}}`;
  
  const sourceFiles = await fg(sourceGlob, {
    cwd,
    ignore,
    absolute: true
  });

  // 3. Scan code for imports/references
  // Simple check: does the file content contain the asset filename?
  // Robust check: does it import it?
  // We'll use a mix: stricter check for imports, looser for string refs?
  // Actually, for assets in source, they are usually imported like: import logo from './logo.png'
  // Or used in CSS/SCSS? (We are only scanning JS/TS files for now per config.extensions)
  
  for (const src of sourceFiles) {
    const content = readSourceFile(src);
    
    for (const [_assetPath, asset] of assetMap) {
      if (asset.used) continue; // Already marked used

      const assetFilename = asset.relativePath.split('/').pop()!; // e.g. logo.png
      
      // Check if filename exists in content (fast fail)
      if (!content.includes(assetFilename)) continue;

      // If it exists, it *might* be used. 
      // To be more precise, we could resolve imports, but assets can be imported from many places.
      // Given the filename is usually unique enough or explicit enough in imports.
      // Let's count it as used if we find the filename. 
      
      asset.used = true;
      asset.references.push(src);
    }
  }

  const assets = Array.from(assetMap.values());
  const used = assets.filter(a => a.used).length;
  const unused = assets.length - used;

  return {
    total: assets.length,
    used,
    unused,
    assets
  };
}
