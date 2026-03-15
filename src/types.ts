export const SCOPE_VALUES = ['local', 'global'] as const;
export const PRESET_VALUES = ['full', 'node-modules', 'build', 'caches', 'aggressive'] as const;
export const CATEGORY_VALUES = [
  'node-modules',
  'build-artifacts',
  'project-caches',
  'logs-temp',
  'package-manager-caches',
  'xcode-derived-data',
  'macos-user-caches-logs'
] as const;
export const DELETION_METHOD_VALUES = ['trash', 'permanent'] as const;

export type Scope = (typeof SCOPE_VALUES)[number];
export type Preset = (typeof PRESET_VALUES)[number];
export type Category = (typeof CATEGORY_VALUES)[number];
export type DeletionMethod = (typeof DELETION_METHOD_VALUES)[number];
export type Intent = 'default' | 'scan' | 'clean';
export type ProgressStage = 'scan' | 'clean';

export interface CliOptions {
  intent: Intent;
  scope?: Scope;
  mode?: Preset;
  path?: string;
  dryRun?: boolean;
  yes?: boolean;
  noTrash?: boolean;
  json?: boolean;
}

export interface CategoryMeta {
  id: Category;
  label: string;
  description: string;
}

export interface PresetMeta {
  id: Preset;
  label: string;
  description: string;
  categories: Category[];
}

export interface TargetDefinition {
  id: string;
  label: string;
  category: Category;
  scopes: Scope[];
  presets: Preset[];
  deletionMethod: DeletionMethod;
  warning: string;
  kind: 'glob-directory' | 'glob-file' | 'absolute-path' | 'absolute-children';
  patterns?: string[];
  paths?: string[];
  priority?: number;
  excludeChildrenByName?: string[];
}

export interface ScanWarning {
  code: 'permission-denied' | 'missing' | 'other';
  message: string;
  path?: string;
}

export interface ScanCandidate {
  key: string;
  definitionId: string;
  label: string;
  category: Category;
  path: string;
  size: number;
  deletionMethod: DeletionMethod;
  warning: string;
  priority: number;
}

export interface ScanProgress {
  stage: ProgressStage;
  current: number;
  total: number;
  message: string;
}

export interface ScanResult {
  candidates: ScanCandidate[];
  warnings: ScanWarning[];
  rootsScanned: string[];
  durationMs: number;
}

export interface CleanupPlan {
  selected: PlannedTarget[];
  totalBytes: number;
  byMethod: Record<DeletionMethod, number>;
  categoryTotals: Record<Category, number>;
  warnings: string[];
}

export interface PlannedTarget extends ScanCandidate {
  selected: boolean;
}

export interface ExecutionProgress {
  current: number;
  total: number;
  targetPath: string;
  method: DeletionMethod;
}

export interface ExecutionResult {
  deleted: PlannedTarget[];
  skipped: PlannedTarget[];
  warnings: ScanWarning[];
  bytesReclaimed: number;
}

export interface RuntimeDefaults {
  cwd: string;
  homeDir: string;
  platform: NodeJS.Platform;
  isInteractive: boolean;
}

export interface AppStateSnapshot {
  scope: Scope;
  preset: Preset;
  basePath: string;
  enabledCategories: Category[];
  deselectedKeys: string[];
}
