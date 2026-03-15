import {rm} from 'node:fs/promises';
import trash from 'trash';
import type {ExecutionProgress, ExecutionResult, PlannedTarget, ScanWarning} from '../types.js';

export interface ExecutePlanOptions {
  targets: PlannedTarget[];
  dryRun?: boolean;
  onProgress?: (progress: ExecutionProgress) => void;
}

export async function executePlan(options: ExecutePlanOptions): Promise<ExecutionResult> {
  const deleted: PlannedTarget[] = [];
  const skipped: PlannedTarget[] = [];
  const warnings: ScanWarning[] = [];

  let current = 0;
  for (const target of options.targets) {
    current += 1;
    options.onProgress?.({
      current,
      total: options.targets.length,
      targetPath: target.path,
      method: target.deletionMethod
    });

    if (options.dryRun) {
      skipped.push(target);
      continue;
    }

    try {
      if (target.deletionMethod === 'trash') {
        await trash([target.path]);
      } else {
        await rm(target.path, {recursive: true, force: true});
      }
      deleted.push(target);
    } catch (error) {
      warnings.push({
        code: 'other',
        message: error instanceof Error ? error.message : String(error),
        path: target.path
      });
      skipped.push(target);
    }
  }

  return {
    deleted,
    skipped,
    warnings,
    bytesReclaimed: deleted.reduce((total, item) => total + item.size, 0)
  };
}
