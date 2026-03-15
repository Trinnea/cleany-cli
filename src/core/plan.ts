import {CATEGORY_VALUES, type Category, type CleanupPlan, type DeletionMethod, type PlannedTarget, type Preset, type ScanResult} from '../types.js';
import {getEnabledCategoriesForPreset} from './registry.js';

export interface BuildPlanOptions {
  preset: Preset;
  enabledCategories?: Category[];
  deselectedKeys?: string[];
  noTrash?: boolean;
  scanResult: Pick<ScanResult, 'candidates'>;
}

export function buildCleanupPlan(options: BuildPlanOptions): CleanupPlan {
  const enabledCategories = options.enabledCategories ?? getEnabledCategoriesForPreset(options.preset);
  const deselected = new Set(options.deselectedKeys ?? []);
  const categoryTotals = Object.fromEntries(CATEGORY_VALUES.map((category) => [category, 0])) as Record<Category, number>;
  const byMethod: Record<DeletionMethod, number> = {trash: 0, permanent: 0};
  const warnings = new Set<string>();
  const selected: PlannedTarget[] = [];

  for (const candidate of options.scanResult.candidates) {
    const isSelected = enabledCategories.includes(candidate.category) && !deselected.has(candidate.key);
    if (!isSelected) {
      continue;
    }

    const deletionMethod = options.noTrash ? 'permanent' : candidate.deletionMethod;
    categoryTotals[candidate.category] += candidate.size;
    byMethod[deletionMethod] += candidate.size;
    warnings.add(candidate.warning);

    selected.push({
      ...candidate,
      deletionMethod,
      selected: true
    });
  }

  return {
    selected,
    totalBytes: selected.reduce((total, item) => total + item.size, 0),
    byMethod,
    categoryTotals,
    warnings: Array.from(warnings)
  };
}
