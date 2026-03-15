import path from 'node:path';
import type {Category, CleanupPlan, CliOptions, RuntimeDefaults, Scope} from '../types.js';
import {buildCleanupPlan} from './plan.js';
import {executePlan} from './execute.js';
import {getDefaultPreset, getDefaultScope} from './registry.js';
import {scanTargets} from './scan.js';
import {formatBytes, formatDuration, formatMethod} from '../utils/format.js';

export interface HeadlessResult {
  exitCode: number;
  output: string;
}

export async function runHeadless(options: CliOptions, runtime: RuntimeDefaults): Promise<HeadlessResult> {
  const scope = options.scope ?? getDefaultScope();
  const preset = options.mode ?? getDefaultPreset();
  const basePath = path.resolve(options.path ?? runtime.cwd);
  const scanResult = await scanTargets({
    scope,
    basePath,
    homeDir: runtime.homeDir,
    enabledCategories: getDefaultCategoriesForRun(options.mode ?? preset)
  });

  const plan = buildCleanupPlan({
    preset,
    enabledCategories: getDefaultCategoriesForRun(options.mode ?? preset),
    deselectedKeys: [],
    noTrash: options.noTrash,
    scanResult
  });

  if (options.json) {
    if (options.intent === 'clean' && !options.dryRun) {
      if (!options.yes) {
        return {
          exitCode: 1,
          output: JSON.stringify({error: 'Non-interactive cleanup requires --yes.'}, null, 2)
        };
      }

      const execution = await executePlan({targets: plan.selected, dryRun: false});
      return {
        exitCode: execution.warnings.length > 0 ? 1 : 0,
        output: JSON.stringify({scope, preset, scanResult, plan, execution}, null, 2)
      };
    }

    return {
      exitCode: 0,
      output: JSON.stringify({scope, preset, scanResult, plan}, null, 2)
    };
  }

  if (options.intent === 'clean' && !options.dryRun) {
    if (!options.yes) {
      return {
        exitCode: 1,
        output: 'Non-interactive cleanup requires --yes. Use --dry-run to preview without deleting.'
      };
    }

    const execution = await executePlan({targets: plan.selected, dryRun: false});
    return {
      exitCode: execution.warnings.length > 0 ? 1 : 0,
      output: renderExecutionText(scope, preset, scanResult.durationMs, plan, execution)
    };
  }

  return {
    exitCode: 0,
    output: renderPlanText(scope, preset, scanResult.durationMs, plan)
  };
}

function renderPlanText(scope: Scope, preset: string, durationMs: number, plan: CleanupPlan): string {
  const rows = plan.selected.slice(0, 12).map((target) => {
    return `- ${target.path} | ${formatBytes(target.size)} | ${formatMethod(target.deletionMethod)}`;
  });
  const remainder = Math.max(0, plan.selected.length - rows.length);
  if (remainder > 0) {
    rows.push(`- +${remainder} more targets`);
  }

  return [
    `Cleany preview`,
    `Scope: ${scope}`,
    `Preset: ${preset}`,
    `Targets: ${plan.selected.length}`,
    `Reclaimable: ${formatBytes(plan.totalBytes)}`,
    `Trash: ${formatBytes(plan.byMethod.trash)}`,
    `Permanent: ${formatBytes(plan.byMethod.permanent)}`,
    `Scan time: ${formatDuration(durationMs)}`,
    '',
    ...rows,
    '',
    'Warnings:',
    ...plan.warnings.map((warning) => `- ${warning}`)
  ].join('\n');
}

function renderExecutionText(scope: Scope, preset: string, durationMs: number, plan: CleanupPlan, execution: Awaited<ReturnType<typeof executePlan>>): string {
  return [
    renderPlanText(scope, preset, durationMs, plan),
    '',
    'Execution:',
    `Deleted: ${execution.deleted.length}`,
    `Skipped: ${execution.skipped.length}`,
    `Bytes reclaimed: ${formatBytes(execution.bytesReclaimed)}`,
    ...execution.warnings.map((warning) => `- ${warning.message}`)
  ].join('\n');
}

function getDefaultCategoriesForRun(preset: string) {
  switch (preset) {
    case 'node-modules':
      return ['node-modules'] as Category[];
    case 'build':
      return ['build-artifacts'] as Category[];
    case 'caches':
      return ['project-caches', 'logs-temp'] as Category[];
    case 'aggressive':
      return [
        'node-modules',
        'build-artifacts',
        'project-caches',
        'logs-temp',
        'package-manager-caches',
        'xcode-derived-data',
        'macos-user-caches-logs'
      ] as Category[];
    default:
      return ['node-modules', 'build-artifacts', 'project-caches', 'logs-temp'] as Category[];
  }
}
