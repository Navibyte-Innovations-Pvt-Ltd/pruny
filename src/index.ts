#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import { rmSync, existsSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { scan, scanUnusedExports } from './scanner.js';
import { scanUnusedServices } from './scanners/unused-services.js';
import { loadConfig } from './config.js';
import { removeExportFromLine, removeMethodFromRoute, findServiceMethodCall, findMethodLine } from './fixer.js';
import { init } from './init.js';
import type { ApiRoute, Config, ScanResult, PrunyOptions, UnusedExport } from './types.js';
import { INVALID_METHOD_NAMES } from './constants.js';
import { getAppName, matchesFilter, resolveFilePath } from './utils.js';

// --- Types ---


interface SummaryItem {
  [key: string]: string | number;
}

// --- Main CLI Action ---

const program = new Command();

program
  .name('pruny')
  .description('Find and remove unused Next.js API routes')
  .version('1.0.0')
  .option('-d, --dir <path>', 'Target directory to scan', './')
  .option('--fix', 'Delete unused API routes')
  .option('--dry-run', 'Run a simulation and output a JSON report')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output as JSON')
  .option('--no-public', 'Disable public assets scanning')
  .option('-v, --verbose', 'Show detailed info')
  .option('-f, --filter <pattern>', 'Filter results by file path or app name')
  .option('--ignore-apps <apps>', 'Comma-separated list of apps to ignore')
  .option('--app <name>', 'Specific app to scan')
  .option('--cleanup <items>', 'Comma-separated list of items to clean (routes, assets, files, exports)')
  .option('--folder <path>', 'Specific folder within an app or project to scan')
  .option('--all', 'Scan all apps (CI mode: exits with error if issues found)');

program
  .command('init')
  .description('Create a default pruny.config.json file')
  .action(() => {
    init();
  });

program.action(async (options: PrunyOptions) => {
  const startTime = Date.now();

  // Auto-detect non-interactive environment (piped stdin, CI, etc.)
  const isNonInteractive = !process.stdin.isTTY || !!process.env.CI;

  try {
    // 1. Setup Configuration
    // 1. Setup Configuration
    const baseConfig = loadConfig({
      dir: options.dir,
      config: options.config,
      excludePublic: !options.public,
    });

    const absoluteDir = baseConfig.dir.startsWith('/')
      ? baseConfig.dir
      : join(process.cwd(), baseConfig.dir);
    baseConfig.dir = absoluteDir;

    if (options.verbose) console.log('');
    console.log(chalk.bold('\n🔍 Scanning for unused API routes...\n'));

    // 2. Monorepo Detection (Auto-find root if we are inside an app)
    let monorepoRoot = absoluteDir;
    let appsDir = join(monorepoRoot, 'apps');
    let isMonorepo = existsSync(appsDir) && lstatSync(appsDir).isDirectory();

    // If not direct monorepo, try going up to find the root
    if (!isMonorepo) {
      let current = absoluteDir;
      while (current !== dirname(current)) {
        const potentialApps = join(current, 'apps');
        if (existsSync(potentialApps) && lstatSync(potentialApps).isDirectory()) {
          monorepoRoot = current;
          appsDir = potentialApps;
          isMonorepo = true;
          break;
        }
        current = dirname(current);
      }
    }

    if (isMonorepo && monorepoRoot !== absoluteDir) {
      // We are scanning an app inside a monorepo
      const _appName = absoluteDir.split('/').pop() || '';
      console.log(chalk.dim(`📦 Detected monorepo root: ${monorepoRoot}`));

      // If we were pointed at a specific app, we should only scan that app's routes
      // but scan the whole root for references.
    }

    // Start Main Navigation Loop
    while (true) {
      const appsToScan: string[] = [];
      const ignoredApps = options.ignoreApps ? options.ignoreApps.split(',').map(a => a.trim()) : [];

      if (isMonorepo) {
        if (monorepoRoot !== absoluteDir) {
          // Direct App Scan (Run from inside an app)
          const appName = relative(join(monorepoRoot, 'apps'), absoluteDir);
          appsToScan.push(appName);
        } else {
          const apps = readdirSync(appsDir);
          const availableApps: string[] = [];

          for (const app of apps) {
            const appPath = join(appsDir, app);
            if (lstatSync(appPath).isDirectory()) {
              availableApps.push(app);
            }
          }

          // Interactive Mode: If no specific ignored apps/filter/json provided
          if (options.app) {
            if (availableApps.includes(options.app)) {
              appsToScan.push(options.app);
            } else {
              console.log(chalk.red(`App "${options.app}" not found in ${appsDir}`));
              process.exit(1);
            }
          } else if (options.all) {
            appsToScan.push(...availableApps.filter(app => !ignoredApps.includes(app)));
          } else if (options.folder) {
            appsToScan.push(...availableApps);
          } else if (!isNonInteractive && !options.ignoreApps && !options.filter && !options.json) {
            const response = await prompts({
              type: 'select',
              name: 'selected',
              message: 'Select app to scan:',
              choices: [
                ...availableApps.map(app => ({ title: app, value: app })),
                { title: chalk.bold('Scan All Apps'), value: 'ALL' },
                { title: chalk.gray('Exit'), value: 'EXIT' }
              ],
              hint: '- Enter to select'
            });

            if (!response.selected || response.selected === 'EXIT') {
              console.log(chalk.gray('Exiting.'));
              break;
            }

            if (response.selected === 'ALL') {
              appsToScan.push(...availableApps);
            } else {
              appsToScan.push(response.selected);
            }
          } else {
            // Non-interactive or filtered
            for (const app of availableApps) {
              if (!ignoredApps.includes(app)) {
                appsToScan.push(app);
              }
            }
            if (appsToScan.length === 0) break; // Exit loop if nothing to scan
          }
        }

        // Deduplicate just in case
        const uniqueApps = [...new Set(appsToScan)];
        appsToScan.length = 0;
        appsToScan.push(...uniqueApps);
      } else {
        appsToScan.push('root');
      }

      let requestedBack = false;
      const isScanAll = isMonorepo && appsToScan.length > 1;
      const allAppResults: { appName: string; result: ScanResult }[] = [];

      // 3. Scan & Fix Loop (Per App)
      for (const appName of appsToScan) {
        // Clone config to modify per app
        const currentConfig = { ...baseConfig };

        // Define app-specific context
        let appLabel = 'Root App';
        let appDir = monorepoRoot;

        if (isMonorepo) {
          appLabel = `App: ${appName}`;
          appDir = join(monorepoRoot, 'apps', appName);

          currentConfig.appSpecificScan = {
            appDir: appDir, // Scan routes ONLY here
            rootDir: monorepoRoot // Scan references EVERYWHERE
          };
        }

        currentConfig.folder = options.folder;

        // For "Scan All" non-fix mode, show compact inline status
        if (isScanAll && !options.fix && !options.json) {
          process.stdout.write(chalk.bold.magenta(`\n👉 Scanning ${appLabel}...`));
        } else {
          console.log(chalk.bold.magenta(`\n👉 Scanning ${appLabel}...`));
        }

        // Perform Scan
        const result = await scan(currentConfig);

        // Filter (if requested)
        if (options.filter) {
          filterResults(result, options.filter);
        }

        // Output JSON or Report
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.fix) {
          // Handle Fixes (Per App) — always per-app interactive
          const fixResult = await handleFixes(result, currentConfig, options, isMonorepo);
          if (fixResult === 'back') {
            requestedBack = true;
            break;
          }
          if (fixResult === 'exit') return; // Absolute exit

          if (options.verbose) {
            printDetailedReport(result);
          }
          printSummaryTable(result, appLabel);
        } else if (isScanAll) {
          // "Scan All" mode: collect results, print consolidated table at end
          const issueCount = countIssues(result);
          if (issueCount > 0) {
            console.log(chalk.yellow(` ${issueCount} issue${issueCount > 1 ? 's' : ''} found`));
          } else {
            console.log(chalk.green(' ✅'));
          }
          allAppResults.push({ appName, result });
        } else {
          // Single app mode: print per-app report
          printSummaryTable(result, appLabel);

          if (options.all) {
            const issues = countIssues(result);
            if (issues > 0) {
              process.exit(1);
            }
          } else if (isNonInteractive) {
            // Non-interactive: print report only, no prompts
            if (hasUnusedItems(result)) {
              printDetailedReport(result);
            }
          } else if (hasUnusedItems(result)) {
            // Interactive fix menu for single projects — same as monorepo --fix flow
            if (options.verbose) {
              printDetailedReport(result);
            }
            const fixResult = await handleFixes(result, currentConfig, options, false);
            if (fixResult === 'exit' || fixResult === 'done') {
              printSummaryTable(result, appLabel);
            }
          } else if (options.verbose) {
            printDetailedReport(result);
          }
        }
      }

      // Print consolidated output for "Scan All" mode
      if (isScanAll && allAppResults.length > 0 && !options.json && !options.fix) {
        // Show detailed issues for apps that have problems
        const appsWithIssues = allAppResults.filter(a => hasUnusedItems(a.result));
        if (appsWithIssues.length > 0) {
          for (const { appName, result } of appsWithIssues) {
            console.log(chalk.bold.magenta(`\n⚠  Issues in ${appName}:`));
            printDetailedReport(result);
          }
        }

        if (!options.all) {
          console.log(chalk.dim('\n💡 Run with --fix to clean up.\n'));
        }
        printConsolidatedTable(allAppResults);

        if (options.all) {
          const totalIssues = allAppResults.reduce((sum, { result }) => sum + countIssues(result), 0);
          if (totalIssues > 0) {
            process.exit(1);
          }
        }
      }

      // If we are not in a monorepo OR we finished all apps without "Back" OR non-interactive
      if (!isMonorepo || (!requestedBack && appsToScan.length > 0) || options.json || options.filter || options.all || isNonInteractive) {
        break;
      }

      // If "Back" was requested, it will loops and show app selection again
    }


  } catch (err) {
    console.error(chalk.red('Error scanning:'), err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(chalk.dim(`\n⏱️  Completed in ${elapsed}s`));
});

program.parse();

// --- Helper Functions ---



/**
 * Filter the scan result object in-place based on a pattern.
 */
function filterResults(result: ScanResult, filterPattern: string) {
  const filter = filterPattern.toLowerCase();
  console.log(chalk.blue(`🔍 Filtering results by "${filter}"...\n`));

  // Filter Routes
  result.routes = result.routes.filter(r => matchesFilter(r.filePath, filter));

  // Filter Assets
  if (result.publicAssets) {
    result.publicAssets.assets = result.publicAssets.assets.filter(a => matchesFilter(a.path, filter));
    result.publicAssets.total = result.publicAssets.assets.length;
    result.publicAssets.used = result.publicAssets.assets.filter(a => a.used).length;
    result.publicAssets.unused = result.publicAssets.assets.filter(a => !a.used).length;
  }

  // Filter Files
  if (result.unusedFiles) {
    result.unusedFiles.files = result.unusedFiles.files.filter(f => matchesFilter(f.path, filter));
    result.unusedFiles.total = result.unusedFiles.files.length;
    result.unusedFiles.unused = result.unusedFiles.files.length;
  }

  // Filter Exports
  if (result.unusedExports) {
    result.unusedExports.exports = result.unusedExports.exports.filter(e => matchesFilter(e.file, filter));
    result.unusedExports.total = result.unusedExports.exports.length;
    result.unusedExports.unused = result.unusedExports.exports.length;
  }

  // Recalculate main stats
  result.total = result.routes.length;
  result.used = result.routes.filter(r => r.used).length;
  result.unused = result.routes.filter(r => !r.used).length;
}

/**
 * Print detailed lists of unused items.
 */
function printDetailedReport(result: ScanResult) {
  // 1. Partially Unused Routes
  const partiallyUnusedRoutes = result.routes.filter(r => r.used && r.unusedMethods.length > 0);
  if (partiallyUnusedRoutes.length > 0) {
    console.log(chalk.yellow.bold('⚠️  Partially Unused API Routes:\n'));
    for (const route of partiallyUnusedRoutes) {
      console.log(chalk.yellow(`   ${route.path}`));
      console.log(chalk.red(`      ❌ Unused: ${route.unusedMethods.join(', ')}`));
      console.log(chalk.dim(`      → ${route.filePath}`));
    }
    console.log('');
  }

  // 2. Fully Unused Routes
  const unusedRoutes = result.routes.filter((r) => !r.used);
  if (unusedRoutes.length > 0) {
    console.log(chalk.red.bold('❌ Unused API Routes (Fully Unused):\n'));
    for (const route of unusedRoutes) {
      const methods = route.methods.length > 0 ? ` (${route.methods.join(', ')})` : '';
      console.log(chalk.red(`   ${route.path}${chalk.dim(methods)}`));
      console.log(chalk.dim(`      → ${route.filePath}`));
    }
    console.log('');
  }

  // 3. Unused Assets
  if (result.publicAssets) {
    const unusedAssets = result.publicAssets.assets.filter(a => !a.used);
    if (unusedAssets.length > 0) {
      console.log(chalk.red.bold('🖼️  Unused Public Assets:\n'));
      for (const asset of unusedAssets) {
        console.log(chalk.red(`   ${asset.relativePath}`));
        console.log(chalk.dim(`      → ${asset.path}`));
      }
      console.log('');
    }
  }

  // 4. Unused Source Files
  if (result.unusedFiles && result.unusedFiles.files.length > 0) {
    console.log(chalk.red.bold('📄 Unused Source Files:\n'));
    for (const file of result.unusedFiles.files) {
      const sizeKb = (file.size / 1024).toFixed(1);
      console.log(chalk.red(`   ${file.path} ${chalk.dim(`(${sizeKb} KB)`)}`));
    }
    console.log('');
  }

  // 5. Unused Exports
  if (result.unusedExports && result.unusedExports.exports.length > 0) {
    console.log(chalk.red.bold('🔗 Unused Named Exports/Methods:\n'));
    for (const exp of result.unusedExports.exports) {
      console.log(chalk.red(`   ${exp.name}`));
      console.log(chalk.dim(`      → ${exp.file}:${exp.line}`));
    }
    console.log('');
  }

  // 6. Missing Assets (Broken Links)
  if (result.missingAssets && result.missingAssets.total > 0) {
    console.log(chalk.yellow.bold('⚠️  Missing Assets (Broken Links):\n'));
    for (const asset of result.missingAssets.assets) {
      console.log(chalk.red(`   ${asset.path}`));
      for (const ref of asset.references) {
        console.log(chalk.dim(`      → Referenced in: ${ref}`));
      }
    }
    console.log('');
  }

  // 7. Unused Services
  if (result.unusedServices && result.unusedServices.methods.length > 0) {
    console.log(chalk.red.bold('🛠️  Unused Service Methods:\n'));
    for (const method of result.unusedServices.methods) {
      console.log(chalk.red(`   ${method.name} (${method.serviceClassName})`));
      console.log(chalk.dim(`      → ${method.file}:${method.line}`));
    }
    console.log('');
  }

  if (!hasUnusedItems(result)) {
    console.log(chalk.green('✅ Everything is used! Clean as a whistle.\n'));
  }
}

/**
 * Check if there are any unused items in the result.
 */
function hasUnusedItems(result: ScanResult): boolean {
  return countIssues(result) > 0;
}

function countIssues(result: ScanResult): number {
  const unusedRoutes = result.routes.filter(r => !r.used).length;
  const partialRoutes = result.routes.filter(r => r.used && r.unusedMethods.length > 0).length;
  const unusedAssets = result.publicAssets ? result.publicAssets.unused : 0;
  const missingAssets = result.missingAssets ? result.missingAssets.total : 0;
  const unusedFiles = result.unusedFiles ? result.unusedFiles.unused : 0;
  const unusedExports = result.unusedExports ? result.unusedExports.unused : 0;
  const unusedServices = result.unusedServices ? result.unusedServices.total : 0;

  return unusedRoutes + partialRoutes + unusedAssets + missingAssets + unusedFiles + unusedExports + unusedServices;
}

/**
 * Execute fixes for unused items.
 */
/**
 * Fixer logic
 */
async function handleFixes(result: ScanResult, config: Config, options: PrunyOptions, showBack: boolean): Promise<'done' | 'back' | 'exit'> {
  // --- 1. Git Safety Check ---
  const gitRoot = findGitRoot(config.dir);
  if (!gitRoot) {
    console.log(chalk.red.bold('\n⚠️  WARNING: No .git directory found!'));
    console.log(chalk.yellow('   Deletions are permanent and cannot be undone.'));

    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to proceed with deletion?',
      initial: false
    });

    if (!confirm) {
      console.log(chalk.gray('Aborted cleanup.'));
      return 'exit';
    }
  }

  // --- Loop: show menu after each fix action ---
  while (true) {
  let _predictedExports: { exports: UnusedExport[] } = { exports: [] };

  // --- 2. Interactive Selection ---

  // Determine what can be cleaned
  const choices = [];

  // a) Unused Routes
  const unusedRoutes = result.routes.filter(r => !r.used);
  // Also partial routes
  const partiallyRoutes = result.routes.filter(r => r.used && r.unusedMethods && r.unusedMethods.length > 0);

  const unusedRoutesCount = unusedRoutes.length;
  const partiallyRoutesCount = partiallyRoutes.length;
  const totalRoutesIssues = unusedRoutesCount + partiallyRoutesCount;

  if (totalRoutesIssues > 0) {
    // Predict cascading deletions (service methods)
    console.log(chalk.dim('\nAnalyzing cascading impact...'));
    _predictedExports = await scanUnusedExports(config, [...unusedRoutes, ...partiallyRoutes], { silent: true });

    // Count only files that will actually be modified (exclude service/controller files skipped in second pass)
    const routeFiles = new Set<string>();
    const rootDir = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
    for (const r of [...unusedRoutes, ...partiallyRoutes]) {
      routeFiles.add(resolve(rootDir, r.filePath));
    }

    const title = `Unused API Routes (${totalRoutesIssues} items in ${routeFiles.size} files)`;

    choices.push({ title, value: 'routes' });
  } else {
    choices.push({ title: `✅ Unused API Routes (0) - All good!`, value: 'routes' });
  }

  // b) Unused Public Assets
  if (result.publicAssets) {
    if (result.publicAssets.unused > 0) {
      choices.push({ title: `Unused Public Files (${result.publicAssets.unused})`, value: 'assets' });
    } else {
      choices.push({ title: `✅ Unused Public Files (0) - All good!`, value: 'assets' });
    }
  }

  // c) Unused Source Files
  if (result.unusedFiles) {
    if (result.unusedFiles.files.length > 0) {
      choices.push({ title: `Unused Code Files (${result.unusedFiles.files.length})`, value: 'files' });
    } else {
      choices.push({ title: `✅ Unused Code Files (0) - All good!`, value: 'files' });
    }
  }

  // d) Unused Exports
  if (result.unusedExports) {
    const unusedExportsCount = result.unusedExports.exports.length;
    if (unusedExportsCount > 0) {
      const uniqueExportFiles = new Set(result.unusedExports.exports.map(e => e.file)).size;
      choices.push({ title: `Unused Exports (${unusedExportsCount} items in ${uniqueExportFiles} files)`, value: 'exports' });
    } else {
      choices.push({ title: `✅ Unused Exports (0) - All good!`, value: 'exports' });
    }
  }

  // e) Unused Services (NestJS only)
  if (result.unusedServices) {
    const count = result.unusedServices.total;
    if (count > 0) {
      const uniqueFiles = new Set(result.unusedServices.methods.map(m => m.file)).size;
      choices.push({ title: `Unused NestJS Service Methods (${count} items in ${uniqueFiles} files)`, value: 'services' });
    } else if (result.routes.some(r => r.type === 'nestjs')) {
      choices.push({ title: `✅ Unused Services (0) - All good!`, value: 'services' });
    }
  }

  // f) Missing Assets (Broken Links)
  if (result.missingAssets) {
    const count = result.missingAssets.total;
    const title = count > 0
      ? `⚠ Missing Assets (Broken Links) (${count})`
      : `✅ Missing Assets (0) - All good!`;
    choices.push({ title, value: 'missing-assets' });
  }


  if (showBack) {
    choices.push({ title: chalk.cyan('← Back'), value: 'back' });
  }
  choices.push({ title: 'Cancel / Exit', value: 'cancel' });

  let selected: string;
  if (options.dryRun || (options.cleanup && options.cleanup.includes('dry-run'))) {
    selected = 'dry-run-json';
  } else if (options.cleanup) {
    selected = 'MANUAL_OVERRIDE';
  } else if (process.env.AUTO_FIX_EXPORTS) {
    if (process.env.AUTO_FIX_EXPORTS === '2') {
      // Special mode to select only exports? Or just 'exports'
      // For now, let's make it select based on value or just string 'exports' if 1
      selected = 'exports';
      // But wait, I want to fix routes too.
      // If I want to fix EVERYTHING, I need a way to say that.
      // The prompting logic selects ONE category. "Unused API Routes", "Unused Exports", etc.
      // If I want to fix routes, I should set it to 'routes'.
      // Let's check what values I need.
      // values: 'routes', 'public', 'code', 'exports', 'missing', 'cancel'
    } else {
      // Default auto fix: usually we want to fix ALL or specific?
      // Let's support comma separated?
      // The current logic only supports selecting ONE category at a time in the loop (it loops after fix).
      // But the loop condition is `while (!exit)`.
      // So I can't easily auto-fix ALL without changing the loop structure or inputs.
      // For this task, I mainly care about 'routes' (Pass 1) and 'exports' (Pass 2).
      // I will hack it:
      // Use an env var that rotates?
      // Or just hardcode it to 'routes' (since that triggers cascading check for exports too?)
      // Wait, selecting 'routes' only fixes routes. It typically DOES NOT fix exports automatically afterwards unless configured.
      // BUT, looking at `handleFix`:
      // If 'routes', it calls `fixApiRoutes`.
      // Then it does `await scan...` again.
      // It DOES NOT automatically select 'exports' next.

      // So I need a way to sequentialize it.
      // I'll implement a simple queue based on env var?
      // Or just let me select via `AUTO_FIX_TYPE`.
      selected = process.env.AUTO_FIX_TYPE || 'exports';
    }
  } else {

    if (config.nestGlobalPrefix || result.routes.some(r => r.type === 'nestjs')) {
      // Don't show Dry Run here anymore
      // choices.unshift({ title: chalk.bold.blue('Dry Run (JSON Report)'), value: 'dry-run-json' });
    }

    const response = await prompts({
      type: 'select',
      name: 'selected',
      message: 'Select items to clean up:',
      choices,
      hint: '- Enter to select'
    });
    selected = response.selected;
  }

  if (!selected || selected === 'cancel') {
    console.log(chalk.gray('Cleanup cancelled.'));
    return 'exit';
  }

  if (selected === 'back') {
    return 'back';
  }

  // --- 2b. Secondary Action Prompt ---
  let action = 'delete';
  if (!options.cleanup && !process.env.AUTO_FIX_EXPORTS) {
    const actionResponse = await prompts({
      type: 'select',
      name: 'action',
      message: `How do you want to proceed with ${chalk.bold(selected)}?`,
      choices: [
        { title: '🗑️  Delete (Fix)', value: 'delete' },
        { title: '📝 Dry Run (JSON Report)', value: 'dry-run' },
        { title: '❌ Cancel', value: 'cancel' }
      ]
    });
    action = actionResponse.action;
  }

  if (action === 'cancel') return 'exit';

  // Always populate predicted exports for cascading check if routes are involved
  const isCleaningRoutes = selected === 'routes' || (options.cleanup && options.cleanup.includes('routes'));
  if (isCleaningRoutes || selected === 'dry-run-json' || action === 'dry-run') {
    const targetRoutes = result.routes.filter(r => !r.used || (r.used && r.unusedMethods?.length > 0));
    // Always calculate if cleaning routes to ensure cascading works correctly
    if (targetRoutes.length > 0) {
      console.log(chalk.dim('   Calculating cascading impact...'));
      _predictedExports = await scanUnusedExports(config, targetRoutes, { silent: true });
    }
  }

  // --- Dry Run JSON ---
  if (action === 'dry-run' || selected === 'dry-run-json') {
    console.log(chalk.dim('Generating dry run report...'));
    let targetRoutes: ApiRoute[] = [];

    if (selected === 'routes' || selected === 'dry-run-json') {
      targetRoutes = result.routes.filter(r => !r.used || (r.used && r.unusedMethods?.length > 0));
    }

    const dryRunReport: { uniqueFiles: number; routes: unknown[]; exports: unknown[] } = {
      uniqueFiles: new Set(targetRoutes.map(r => r.filePath)).size,
      routes: [],
      exports: []
    };

    if (selected === 'routes' || selected === 'dry-run-json' || action === 'dry-run') {
      dryRunReport.routes = targetRoutes.map(r => ({
        path: r.path,
        filePath: r.filePath,
        type: r.type,
        unusedMethods: r.unusedMethods,
        relatedServiceMethods: r.type === 'nestjs' ? r.unusedMethods.map(m => {
          const rawPath = r.filePath;
          const absolutePath = resolveFilePath(rawPath, config);
          const tsMethodName = r.methodNames ? r.methodNames[m] : m;
          const methodLine = r.methodLines[m] || 0;

          const serviceCall = findServiceMethodCall(absolutePath, tsMethodName || m, methodLine);
          if (serviceCall) {
            const relativeServiceFile = relative(config.dir, serviceCall.serviceFile);
            const serviceLine = findMethodLine(serviceCall.serviceFile, serviceCall.serviceMethod);
            return {
              method: m,
              serviceFile: relativeServiceFile,
              serviceMethod: serviceCall.serviceMethod,
              willBeDeleted: serviceLine !== null
            };
          }
          return null;
        }).filter(Boolean) : []
      }));
    }

    if (selected === 'exports') {
      const exportsList = result.unusedExports?.exports || [];
      dryRunReport.exports = exportsList.map(e => ({
        name: e.name,
        file: e.file,
        line: e.line
      }));
      dryRunReport.uniqueFiles = new Set(exportsList.map(e => e.file)).size;
    }

    if (selected === 'services') {
      const servicesList = result.unusedServices?.methods || [];
      dryRunReport.exports = servicesList.map(m => ({
        name: m.name,
        file: m.file,
        line: m.line,
        serviceClassName: m.serviceClassName
      }));
      dryRunReport.uniqueFiles = new Set(servicesList.map(m => m.file)).size;
    }

    const reportPath = join(process.cwd(), 'pruny-dry-run.json');
    writeFileSync(reportPath, JSON.stringify(dryRunReport, null, 2));
    console.log(chalk.green(`\n✅ Dry run report saved to: ${chalk.bold(reportPath)}`));

    return 'exit';
  }


  const selectedList = options.cleanup
    ? options.cleanup.split(',').map(s => s.trim())
    : [selected];

  let fixedSomething = false;

  // --- 3. Execute Selected Cleanups ---

  // 3x. Missing Assets
  if (selectedList.includes('missing-assets')) {
    if (result.missingAssets && result.missingAssets.total > 0) {
      console.log(chalk.yellow.bold('\n⚠  Broken Links Detected:'));
      console.log(chalk.gray('   (Automatic removal is unsafe. Please manually fix the following references:)'));

      for (const asset of result.missingAssets.assets) {
        console.log(chalk.red.bold(`\n   ❌ Missing: ${asset.path}`));
        for (const ref of asset.references) {
          console.log(chalk.gray(`      ➜ ${ref}`));
        }
      }
      console.log(chalk.yellow('\n   Please open these files and remove/fix the references.'));
    } else {
      console.log(chalk.green('\n✅ No missing assets found! Nothing to fix here.'));
    }
  }

  // 3a. Public Assets (Priority 1 per request)
  if (selectedList.includes('assets')) {
    if (result.publicAssets && result.publicAssets.unused > 0) {
      console.log(chalk.yellow.bold('\n🗑️  Deleting unused public assets...'));
      for (const asset of result.publicAssets.assets) {
        if (!asset.used) {
          try {
            const fullPath = asset.path; // Already absolute
            if (existsSync(fullPath)) {
              rmSync(fullPath, { force: true });
              console.log(chalk.red(`   Deleted: ${asset.relativePath}`));
              fixedSomething = true;
            }
          } catch (_e) {
            console.log(chalk.red(`   Failed to delete: ${asset.relativePath}`));
          }
        }
      }
      // Reset count
      result.publicAssets.unused = 0;
      result.publicAssets.assets = result.publicAssets.assets.filter(a => a.used);
    } else {
      console.log(chalk.green('\n✅ No unused public assets found!'));
    }
  }

  // 3b. API Routes
  if (selectedList.includes('routes')) {
    const unusedRoutes = result.routes.filter(r => !r.used);
    const partiallyRoutes = result.routes.filter(r => r.used && r.unusedMethods && r.unusedMethods.length > 0);

    if (unusedRoutes.length === 0 && partiallyRoutes.length === 0) {
      console.log(chalk.green('\n✅ No unused API routes found!'));
    } else {
      console.log(chalk.yellow.bold('\n🗑️  Cleaning up API routes...'));

      const filesToUnlink = new Set<string>();
      const removalsByFile = new Map<string, { name: string; line: number; label: string }[]>();

      const addRemoval = (absPath: string, name: string, line: number, label: string) => {
        if (!removalsByFile.has(absPath)) removalsByFile.set(absPath, []);
        // Avoid duplicates
        if (!removalsByFile.get(absPath)!.some(r => r.name === name && r.line === line)) {
          removalsByFile.get(absPath)!.push({ name, line, label });
        }
      };

      // 1. Process Unused Routes (Full)
      const routesByFile = new Map<string, ApiRoute[]>();
      for (const r of unusedRoutes) {
        const list = routesByFile.get(r.filePath) || [];
        list.push(r);
        routesByFile.set(r.filePath, list);
      }

      for (const [filePath, fileRoutes] of routesByFile) {
        const fullPath = resolveFilePath(filePath, config);
        const route = fileRoutes[0];

        if (route.type === 'nextjs' && (filePath.includes('app/api') || filePath.includes('pages/api'))) {
          filesToUnlink.add(dirname(fullPath)); // Delete folder
        } else if (route.type === 'nestjs' && (result.unusedFiles?.files.some(f => f.path === filePath) || filePath.includes('api/'))) {
          filesToUnlink.add(fullPath); // Delete whole controller file
        } else {
          // Partial removal for ALL routes in this file
          for (const r of fileRoutes) {
            for (const m of r.unusedMethods) {
              const line = r.methodLines[m];
              if (line !== undefined) {
                addRemoval(fullPath, r.methodNames?.[m] || m, line, r.path);

                // Cascading deletion: SKIP in first pass - too error prone
                // Let the second pass handle service method deletion more safely
                // The second pass checks if any controller uses the method
                if (r.type === 'nestjs') {
                  const serviceCall = findServiceMethodCall(fullPath, r.methodNames?.[m] || m, line);
                  if (serviceCall) {
                    const serviceMethodLine = findMethodLine(serviceCall.serviceFile, serviceCall.serviceMethod);
                    if (serviceMethodLine) {
                      console.log(chalk.cyan(`      ℹ Service method ${serviceCall.serviceMethod} will be checked in second pass`));
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 2. Process Partially Used Routes
      for (const r of partiallyRoutes) {
        const fullPath = resolveFilePath(r.filePath, config);
        for (const m of r.unusedMethods) {
          const line = r.methodLines[m];
          if (line !== undefined) {
            addRemoval(fullPath, r.methodNames?.[m] || m, line, r.path);

            // Cascading deletion: SKIP in first pass - too error prone
            // Let the second pass handle service method deletion more safely
            if (r.type === 'nestjs') {
              const serviceCall = findServiceMethodCall(fullPath, r.methodNames?.[m] || m, line);
              if (serviceCall) {
                const serviceMethodLine = findMethodLine(serviceCall.serviceFile, serviceCall.serviceMethod);
                if (serviceMethodLine) {
                  console.log(chalk.cyan(`      ℹ Service method ${serviceCall.serviceMethod} will be checked in second pass`));
                }
              }
            }
          }
        }
      }

      // 3. Apply Full Deletions — track what was ACTUALLY deleted
      const actuallyDeleted = new Set<string>();
      for (const path of filesToUnlink) {
        if (existsSync(path)) {
          rmSync(path, { recursive: true, force: true });
          actuallyDeleted.add(path);
          console.log(chalk.red(`   Deleted: ${relative(config.dir, path)}`));
          fixedSomething = true;
        } else {
          console.log(chalk.yellow(`      ⚠ Path not found, skipping: ${relative(config.dir, path)}`));
        }
      }

      // 4. Apply Partial Removals — track which files were ACTUALLY modified
      const actuallyFixed = new Set<string>();
      for (const [absPath, removals] of removalsByFile) {
        if (actuallyDeleted.has(absPath) || actuallyDeleted.has(dirname(absPath))) continue;
        if (!existsSync(absPath)) continue;

        const sortedRemovals = removals.sort((a, b) => b.line - a.line);
        for (const rem of sortedRemovals) {
          if (removeMethodFromRoute('', absPath, rem.name, rem.line)) {
            actuallyFixed.add(absPath);
            console.log(chalk.green(`      Fixed: Removed ${rem.name} from ${relative(config.dir, absPath)} (${rem.label})`));
            fixedSomething = true;
          }
        }
      }

      // Update result object — only remove/update routes that were ACTUALLY fixed on disk
      result.routes = result.routes.filter(r => {
        const fullPath = resolveFilePath(r.filePath, config);
        if (actuallyDeleted.has(fullPath) || actuallyDeleted.has(dirname(fullPath))) return false;
        if (actuallyFixed.has(fullPath)) {
          r.unusedMethods = [];
          r.used = true;
          return true;
        }
        return true;
      });
    }
  }



  // 3c. Unused Source Files
  if (selectedList.includes('files')) {
    if (result.unusedFiles && result.unusedFiles.files.length > 0) {
      console.log(chalk.yellow.bold('\n🗑️  Deleting unused source files...'));
      for (const file of result.unusedFiles.files) {
        try {
          const fullPath = join(config.dir, file.path);
          if (!existsSync(fullPath)) continue;
          rmSync(fullPath, { force: true });
          console.log(chalk.red(`   Deleted: ${file.path}`));
          fixedSomething = true;
        } catch (_err) {
          console.log(chalk.yellow(`   Failed to delete: ${file.path}`));
        }
      }
      result.unusedFiles.files = [];
      result.unusedFiles.unused = 0;
    } else {
      console.log(chalk.green('\n✅ No unused source files found!'));
    }
  }

  // 3d. Unused Exports
  if (selectedList.includes('exports')) {
    if (result.unusedExports && result.unusedExports.exports.length > 0) {
      fixedSomething = (await fixUnusedExports(result, config)) || fixedSomething;
    } else {
      console.log(chalk.green('\n✅ No unused exports found!'));
    }
  }

  // 3e. Unused Services
  if (selectedList.includes('services')) {
    if (result.unusedServices && result.unusedServices.methods.length > 0) {
      console.log(chalk.yellow.bold('\n🔧 Fixing unused service methods...\n'));

      // Safety: keywords that must never be treated as method names (from shared constants)

      const methodsByFile = new Map<string, typeof result.unusedServices.methods>();
      for (const method of result.unusedServices.methods) {
        if (!methodsByFile.has(method.file)) methodsByFile.set(method.file, []);
        methodsByFile.get(method.file)!.push(method);
      }

      let fixedCount = 0;
      for (const [file, methods] of methodsByFile.entries()) {
        const fullPath = join(config.dir, file);
        if (!existsSync(fullPath)) continue;

        // Sort reverse order to not mess up line numbers when deleting
        const sortedMethods = methods.sort((a, b) => b.line - a.line);

        for (const method of sortedMethods) {
          // Safety check: skip keywords that should never be method names
          if (INVALID_METHOD_NAMES.has(method.name)) {
            console.log(chalk.yellow(`   ⚠ Skipping "${method.name}" in ${file} - not a valid method name`));
            continue;
          }
          if (removeMethodFromRoute(config.dir, file, method.name, method.line)) {
            console.log(chalk.green(`   Fixed: ${method.name} in ${file}`));
            fixedCount++;
            fixedSomething = true;
          }
        }
      }

      if (fixedCount > 0) {
        console.log(chalk.green(`\n✅ Cleaned up ${fixedCount} unused service method(s).\n`));
      }
      
      result.unusedServices.methods = [];
      result.unusedServices.total = 0;
    } else {
      console.log(chalk.green('\n✅ No unused services found!'));
    }
  }

  // 5. CASCADING SCAN
  if (fixedSomething) {
    console.log(chalk.cyan.bold('\n🔄 Checking for cascading dead code (newly unused implementation)...'));
    const secondPass = await scanUnusedExports(config);

    // Apply filter to second pass if needed
    if (options.filter) {
      const filter = options.filter.toLowerCase();
      secondPass.exports = secondPass.exports.filter(e => matchesFilter(e.file, filter));
      secondPass.total = secondPass.exports.length;
      secondPass.unused = secondPass.exports.length;
    }

    // Service method deletion: SKIP ALL service method deletions in second pass
    // This is the safest approach - detection logic is error-prone
    // Users can manually clean up unused service methods if needed
    secondPass.exports = secondPass.exports.filter(exp => {
      // Skip ALL service files - too risky to delete service methods automatically
      if (exp.file.endsWith('.service.ts') || exp.file.endsWith('.service.tsx')) {
        console.log(chalk.yellow(`      ⚠ Skipping ${exp.name} in ${exp.file} - service method (manual cleanup required)`));
        return false;
      }
      // Skip controller files - methods are route handlers, not standard exports.
      // Controller methods should only be removed via the route scanner (first pass),
      // which correctly checks API usage across the entire monorepo.
      if (exp.file.endsWith('.controller.ts') || exp.file.endsWith('.controller.tsx')) {
        console.log(chalk.yellow(`      ⚠ Skipping ${exp.name} in ${exp.file} - controller method (manual cleanup required)`));
        return false;
      }
      return true;
    });


    secondPass.unused = secondPass.exports.length;
    secondPass.total = secondPass.exports.length;

    if (secondPass.unused > 0) {
      console.log(chalk.yellow(`   Found ${secondPass.unused} newly unused items/methods after pruning.\n`));
      result.unusedExports = secondPass;
      await fixUnusedExports(result, config);
    }

    // 5b. CASCADING SERVICE CLEANUP — auto-remove NEWLY orphaned service methods only
    // Methods that were already unused before the fix should be handled via the "Unused Services" menu
    if (result.routes.some(r => r.type === 'nestjs')) {
      process.stdout.write(chalk.cyan('   Scanning for orphaned service methods...'));
      const serviceResult = await scanUnusedServices(config);

      // Filter to only NEWLY orphaned methods (not already known before fix)
      const preExisting = new Set(
        (result.unusedServices?.methods || []).map(m => `${m.file}:${m.name}`)
      );
      const newlyOrphaned = serviceResult.methods.filter(
        m => !preExisting.has(`${m.file}:${m.name}`)
      );
      console.log(chalk.cyan(` ${newlyOrphaned.length} new`));

      if (newlyOrphaned.length > 0) {
        console.log(chalk.yellow(`   Found ${newlyOrphaned.length} newly orphaned service method(s). Cleaning up...\n`));

        const svcByFile = new Map<string, typeof serviceResult.methods>();
        for (const method of newlyOrphaned) {
          if (!svcByFile.has(method.file)) svcByFile.set(method.file, []);
          svcByFile.get(method.file)!.push(method);
        }

        let svcFixedCount = 0;
        for (const [file, methods] of svcByFile.entries()) {
          const fullPath = join(config.dir, file);
          if (!existsSync(fullPath)) continue;

          const sortedMethods = methods.sort((a, b) => b.line - a.line);
          for (const method of sortedMethods) {
            if (removeMethodFromRoute(config.dir, file, method.name, method.line)) {
              console.log(chalk.green(`      Fixed: ${method.name} in ${file} (cascading)`));
              svcFixedCount++;
            }
          }
        }

        if (svcFixedCount > 0) {
          console.log(chalk.green(`\n   ✅ Cleaned up ${svcFixedCount} orphaned service method(s).`));
        }
      } else {
        console.log(chalk.green('   ✅ No orphaned service methods found.'));
      }

      // Update the result with the fresh service scan for accurate menu counts
      result.unusedServices = serviceResult;
    }
  }

  if (fixedSomething) {
    result.unused = result.routes.filter(r => !r.used).length;
    result.used = result.routes.filter(r => r.used).length;
    result.total = result.routes.length;
  }

  // Loop back to show the menu again for the next action
  console.log('');
  continue;
  } // end while(true)
}


/**
 * Helper to fix unused exports in the result object
 */
async function fixUnusedExports(result: ScanResult, config: Config): Promise<boolean> {
  if (!result.unusedExports || result.unusedExports.exports.length === 0) return false;

  console.log(chalk.yellow.bold('🔧 Fixing unused exports/methods...\n'));

  const exportsByFile = new Map<string, typeof result.unusedExports.exports>();
  for (const exp of result.unusedExports.exports) {
    if (!exportsByFile.has(exp.file)) exportsByFile.set(exp.file, []);
    exportsByFile.get(exp.file)!.push(exp);
  }

  let fixedCount = 0;
  let fixedSomething = false;

  for (const [_file, exports] of exportsByFile.entries()) {
    // Sort reverse order to not mess up line numbers when deleting
    const sortedExports = exports.sort((a, b) => b.line - a.line);

    for (const exp of sortedExports) {
      const fullPath = join(config.dir, exp.file);
      if (!existsSync(fullPath)) continue;

      if (removeExportFromLine(config.dir, exp)) {
        console.log(chalk.green(`   Fixed: ${exp.name} in ${exp.file}`));
        fixedCount++;
        fixedSomething = true;

        const expIdx = result.unusedExports!.exports.indexOf(exp);
        if (expIdx !== -1) {
          result.unusedExports!.exports.splice(expIdx, 1);
          result.unusedExports!.unused--;
        }
      }
    }
  }

  if (fixedCount > 0) console.log(chalk.green(`\n✅ Cleaned up ${fixedCount} unused item(s).\n`));
  return fixedSomething;
}

/**
 * Print the final summary table.
 */
function printSummaryTable(result: ScanResult, context: string) {
  console.log(chalk.bold(`📊 Summary Report for ${context}\n`));

  const summary: SummaryItem[] = [];
  const groupedRoutes = new Map<string, { type: string; app: string; routes: ApiRoute[] }>();

  for (const route of result.routes) {
    const keyAppName = getAppName(route.filePath);
    const key = `${keyAppName}::${route.type}`;
    if (!groupedRoutes.has(key)) {
      groupedRoutes.set(key, { type: route.type, app: keyAppName, routes: [] });
    }
    groupedRoutes.get(key)!.routes.push(route);
  }

  const sortedKeys = Array.from(groupedRoutes.keys()).sort((a, b) => {
    const [appA, typeA] = a.split('::');
    const [appB, typeB] = b.split('::');
    if (typeA !== typeB) return typeA === 'nextjs' ? -1 : 1;
    return appA.localeCompare(appB);
  });

  for (const key of sortedKeys) {
    const group = groupedRoutes.get(key)!;
    const typeLabel = group.type === 'nextjs' ? 'API Routes (Next.js)' : 'API Routes (NestJS)';
    summary.push({
      Category: `${typeLabel} (${group.app})`,
      Total: group.routes.length,
      Used: group.routes.filter(r => r.used).length,
      Unused: group.routes.filter(r => !r.used).length,
    });
  }

  if (summary.length === 0) summary.push({ Category: 'API Routes', Total: result.total, Used: result.used, Unused: result.unused });

  // Detect project type from routes
  const hasNestRoutes = result.routes.some(r => r.type === 'nestjs');
  const hasNextRoutes = result.routes.some(r => r.type === 'nextjs');

  // Public assets — only relevant for Next.js or when assets exist
  if (result.publicAssets && (hasNextRoutes || result.publicAssets.total > 0)) {
    summary.push({ Category: 'Public Files (public/)', Total: result.publicAssets.total, Used: result.publicAssets.used, Unused: result.publicAssets.unused });
  }

  // Missing assets — only show when there are actual issues
  if (result.missingAssets && result.missingAssets.total > 0) {
    summary.push({
      Category: chalk.red.bold('⚠ Missing Assets'),
      Total: result.missingAssets.total,
      Used: '-',
      Unused: result.missingAssets.total
    });
  }

  if (result.unusedFiles) summary.push({ Category: 'Code Files (.ts/.js)', Total: result.unusedFiles.used + result.unusedFiles.unused, Used: result.unusedFiles.used, Unused: result.unusedFiles.unused });
  if (result.unusedExports) summary.push({ Category: 'Named Exports', Total: result.unusedExports.used + result.unusedExports.unused, Used: result.unusedExports.used, Unused: result.unusedExports.unused });

  // NestJS services — only show for NestJS projects
  if (result.unusedServices && hasNestRoutes) {
    summary.push({ Category: 'NestJS Services', Total: result.unusedServices.total, Used: '-', Unused: result.unusedServices.total });
  }

  // HTTP usage — only show clients that are actually used in the project
  if (result.httpUsage) {
    if (result.httpUsage.axios > 0) {
      summary.push({ Category: 'Axios Calls', Total: result.httpUsage.axios, Used: result.httpUsage.axios, Unused: '-' });
    }
    if (result.httpUsage.fetch > 0) {
      summary.push({ Category: 'Fetch Calls', Total: result.httpUsage.fetch, Used: result.httpUsage.fetch, Unused: '-' });
    }
    if (result.httpUsage.got > 0) {
      summary.push({ Category: 'Got Calls', Total: result.httpUsage.got, Used: result.httpUsage.got, Unused: '-' });
    }
    if (result.httpUsage.ky > 0) {
      summary.push({ Category: 'Ky Calls', Total: result.httpUsage.ky, Used: result.httpUsage.ky, Unused: '-' });
    }
  }

  printTable(summary);

  // Show missing asset details inline — users need file paths to fix broken links
  if (result.missingAssets && result.missingAssets.total > 0) {
    console.log(chalk.yellow.bold('\n⚠  Missing Assets (Broken Links):\n'));
    for (const asset of result.missingAssets.assets) {
      console.log(chalk.red(`   ✗ ${asset.path}`));
      for (const ref of asset.references) {
        console.log(chalk.dim(`     → Referenced in: ${ref}`));
      }
    }
    console.log(chalk.yellow('\n   These files are referenced in code but don\'t exist. Update the links or create the files.'));
  }
}

/**
 * Print a consolidated table for "Scan All Apps" mode — one row per app.
 */
function printConsolidatedTable(allResults: { appName: string; result: ScanResult }[]) {
  console.log(chalk.bold(`📊 Monorepo Summary\n`));

  const summary: SummaryItem[] = [];

  let totalRoutes = 0, totalFiles = 0, totalExports = 0, totalIssues = 0;

  for (const { appName, result } of allResults) {
    const routes = result.routes.length;
    const files = result.unusedFiles ? result.unusedFiles.used + result.unusedFiles.unused : 0;
    const exports = result.unusedExports ? result.unusedExports.used + result.unusedExports.unused : 0;
    const issues = countIssues(result);

    // Detect framework type from routes
    const hasNest = result.routes.some(r => r.type === 'nestjs');
    const hasNext = result.routes.some(r => r.type === 'nextjs');
    const framework = hasNest && hasNext ? 'NestJS + Next.js' : hasNest ? 'NestJS' : hasNext ? 'Next.js' : '';
    const label = framework ? `${appName} (${framework})` : appName;

    summary.push({
      Category: issues > 0 ? chalk.yellow(label) : label,
      Routes: routes,
      Files: files,
      Exports: exports,
      Issues: issues > 0 ? chalk.red(String(issues)) : chalk.green(String(issues)),
    });

    totalRoutes += routes;
    totalFiles += files;
    totalExports += exports;
    totalIssues += issues;
  }

  // Add totals row
  summary.push({
    Category: chalk.bold('Total'),
    Routes: totalRoutes,
    Files: totalFiles,
    Exports: totalExports,
    Issues: totalIssues > 0 ? chalk.red.bold(String(totalIssues)) : chalk.green.bold(String(totalIssues)),
  });

  printTable(summary);

  if (totalIssues === 0) {
    console.log(chalk.green('\n✅ All apps are clean!'));
  }
}

function printTable(summary: SummaryItem[]) {
  if (summary.length === 0) return;

  const keys = Object.keys(summary[0]);
  // Include (index) column
  const headers = ['(index)', ...keys];

  // Calculate widths
  // Pre-calculate formatted values
  const ansiRegex = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
  const rows = summary.map((item: SummaryItem, rowIndex) => {
    return [
      String(rowIndex),
      ...keys.map(k => {
        const val = item[k];
        if (val === '-') return chalk.yellow('-');
        // Don't quote strings that already have ANSI color codes (chalk output)
        if (typeof val === 'string' && ansiRegex.test(val)) { ansiRegex.lastIndex = 0; return val; }
        if (typeof val === 'string') return `'${val}'`;
        return chalk.yellow(String(val));
      })
    ];
  });

  // Calculate widths based on VISIBLE length
  const colWidths = headers.map(h => h.length);

  rows.forEach(row => {
    row.forEach((val, i) => {
      // Strip ANSI codes for length
      const visibleLength = val.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '').length;
      if (visibleLength > colWidths[i]) colWidths[i] = visibleLength;
    });
  });

  // Add padding
  const PADDING = 2; // 1 space on each side
  const widths = colWidths.map(w => w + PADDING);

  // Box drawing chars
  const chars = {
    top: '─', topMid: '┬', topLeft: '┌', topRight: '┐',
    bottom: '─', bottomMid: '┴', bottomLeft: '└', bottomRight: '┘',
    mid: '─', midMid: '┼', midLeft: '├', midRight: '┤',
    left: '│', right: '│', middle: '│'
  };

  // Helper to pad string
  const pad = (str: string, width: number) => {
    const visibleLength = str.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '').length;
    return ' ' + str + ' '.repeat(width - visibleLength - 1);
  };

  // 1. Top Border
  let line = chars.topLeft + widths.map(w => chars.top.repeat(w)).join(chars.topMid) + chars.topRight;
  console.log(line);

  // 2. Headers
  line = chars.left + headers.map((h, i) => pad(h, widths[i])).join(chars.middle) + chars.right;
  console.log(line);

  // 3. Divider
  line = chars.midLeft + widths.map(w => chars.mid.repeat(w)).join(chars.midMid) + chars.midRight;
  console.log(line);

  // 4. Rows
  rows.forEach((formattedValues) => {
    const line = chars.left + formattedValues.map((v, i) => pad(v, widths[i])).join(chars.middle) + chars.right;
    console.log(line);
  });

  // 5. Bottom Border
  line = chars.bottomLeft + widths.map(w => chars.bottom.repeat(w)).join(chars.bottomMid) + chars.bottomRight;
  console.log(line);
}

/**
 * Recursively check for .git directory up the tree
 */
function findGitRoot(startDir: string): boolean {
  let currentDir = startDir;
  while (currentDir !== dirname(currentDir)) { // Stop at root
    if (existsSync(join(currentDir, '.git'))) {
      return true;
    }
    currentDir = dirname(currentDir);
  }
  return false;
}

