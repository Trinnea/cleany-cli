import path from 'node:path';
import os from 'node:os';
import {
  CATEGORY_VALUES,
  PRESET_VALUES,
  type Category,
  type CategoryMeta,
  type Preset,
  type PresetMeta,
  type RuntimeDefaults,
  type Scope,
  type TargetDefinition
} from '../types.js';
import {expandHome, pathExists, uniquePaths} from '../utils/paths.js';

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  'node-modules': {
    id: 'node-modules',
    label: 'Node Modules',
    description: 'Large dependency folders that can be reinstalled.'
  },
  'build-artifacts': {
    id: 'build-artifacts',
    label: 'Build Artifacts',
    description: 'Framework output such as .next, dist, build, and coverage.'
  },
  'project-caches': {
    id: 'project-caches',
    label: 'Project Caches',
    description: 'Local caches used by build tools and bundlers.'
  },
  'logs-temp': {
    id: 'logs-temp',
    label: 'Logs and Temp',
    description: 'Local debug logs and temporary folders inside projects.'
  },
  'package-manager-caches': {
    id: 'package-manager-caches',
    label: 'Package Manager Caches',
    description: 'Global npm, pnpm, yarn, and bun caches.'
  },
  'xcode-derived-data': {
    id: 'xcode-derived-data',
    label: 'Xcode DerivedData',
    description: 'Xcode build caches that can be regenerated.'
  },
  'macos-user-caches-logs': {
    id: 'macos-user-caches-logs',
    label: 'macOS User Caches and Logs',
    description: 'User-level Library caches and logs with explicit warnings.'
  }
};

export const PRESET_META: Record<Preset, PresetMeta> = {
  full: {
    id: 'full',
    label: 'Full',
    description: 'Node modules, build artifacts, project caches, and temp logs.',
    categories: ['node-modules', 'build-artifacts', 'project-caches', 'logs-temp']
  },
  'node-modules': {
    id: 'node-modules',
    label: 'Node Modules',
    description: 'Only dependency folders.',
    categories: ['node-modules']
  },
  build: {
    id: 'build',
    label: 'Build Artifacts',
    description: 'Framework and compiler output.',
    categories: ['build-artifacts']
  },
  caches: {
    id: 'caches',
    label: 'Caches',
    description: 'Project caches and temp logs.',
    categories: ['project-caches', 'logs-temp']
  },
  aggressive: {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Full cleanup plus global caches, logs, and Xcode DerivedData.',
    categories: CATEGORY_VALUES.slice()
  }
};

export const TARGET_DEFINITIONS: TargetDefinition[] = [
  {
    id: 'node-modules-dir',
    label: 'node_modules',
    category: 'node-modules',
    scopes: ['local', 'global'],
    presets: ['full', 'node-modules', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Dependencies will need to be reinstalled after cleanup.',
    kind: 'glob-directory',
    patterns: ['**/node_modules'],
    priority: 10
  },
  {
    id: 'next-dir',
    label: '.next',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Next.js build output will be regenerated on the next build.',
    kind: 'glob-directory',
    patterns: ['**/.next'],
    priority: 10
  },
  {
    id: 'nuxt-dir',
    label: '.nuxt',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Nuxt build output will be regenerated on the next build.',
    kind: 'glob-directory',
    patterns: ['**/.nuxt'],
    priority: 10
  },
  {
    id: 'svelte-kit-dir',
    label: '.svelte-kit',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'SvelteKit build output will be regenerated on the next build.',
    kind: 'glob-directory',
    patterns: ['**/.svelte-kit'],
    priority: 10
  },
  {
    id: 'turbo-dir',
    label: '.turbo',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Turbo cache will be recreated as tasks run again.',
    kind: 'glob-directory',
    patterns: ['**/.turbo'],
    priority: 10
  },
  {
    id: 'parcel-cache-dir',
    label: '.parcel-cache',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Parcel cache will be regenerated.',
    kind: 'glob-directory',
    patterns: ['**/.parcel-cache'],
    priority: 10
  },
  {
    id: 'dist-dir',
    label: 'dist',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Distribution output will need to be rebuilt.',
    kind: 'glob-directory',
    patterns: ['**/dist'],
    priority: 6
  },
  {
    id: 'build-dir',
    label: 'build',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Build output will need to be rebuilt.',
    kind: 'glob-directory',
    patterns: ['**/build'],
    priority: 5
  },
  {
    id: 'coverage-dir',
    label: 'coverage',
    category: 'build-artifacts',
    scopes: ['local', 'global'],
    presets: ['full', 'build', 'aggressive'],
    deletionMethod: 'trash',
    warning: 'Coverage reports will be removed.',
    kind: 'glob-directory',
    patterns: ['**/coverage'],
    priority: 5
  },
  {
    id: 'project-cache-dir',
    label: '.cache',
    category: 'project-caches',
    scopes: ['local', 'global'],
    presets: ['full', 'caches', 'aggressive'],
    deletionMethod: 'permanent',
    warning: 'Project caches will be rebuilt as tools run again.',
    kind: 'glob-directory',
    patterns: ['**/.cache'],
    priority: 10
  },
  {
    id: 'vite-dir',
    label: '.vite',
    category: 'project-caches',
    scopes: ['local', 'global'],
    presets: ['full', 'caches', 'aggressive'],
    deletionMethod: 'permanent',
    warning: 'Vite cache will be regenerated.',
    kind: 'glob-directory',
    patterns: ['**/.vite'],
    priority: 10
  },
  {
    id: 'eslint-cache-file',
    label: '.eslintcache',
    category: 'project-caches',
    scopes: ['local', 'global'],
    presets: ['full', 'caches', 'aggressive'],
    deletionMethod: 'permanent',
    warning: 'ESLint will recreate this cache when needed.',
    kind: 'glob-file',
    patterns: ['**/.eslintcache'],
    priority: 10
  },
  {
    id: 'dot-tmp-dir',
    label: '.tmp/.temp',
    category: 'logs-temp',
    scopes: ['local', 'global'],
    presets: ['full', 'caches', 'aggressive'],
    deletionMethod: 'permanent',
    warning: 'Temporary folders are removed permanently.',
    kind: 'glob-directory',
    patterns: ['**/.tmp', '**/.temp'],
    priority: 4
  },
  {
    id: 'debug-log-files',
    label: 'Debug log files',
    category: 'logs-temp',
    scopes: ['local', 'global'],
    presets: ['full', 'caches', 'aggressive'],
    deletionMethod: 'permanent',
    warning: 'Debug logs are removed permanently.',
    kind: 'glob-file',
    patterns: ['**/npm-debug.log*', '**/yarn-debug.log*', '**/yarn-error.log*', '**/pnpm-debug.log*'],
    priority: 4
  },
  {
    id: 'npm-cache',
    label: 'npm cache',
    category: 'package-manager-caches',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'npm packages may download again on the next install.',
    kind: 'absolute-path',
    paths: ['~/.npm'],
    priority: 30
  },
  {
    id: 'pnpm-store',
    label: 'pnpm store',
    category: 'package-manager-caches',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'pnpm packages may download again on the next install.',
    kind: 'absolute-path',
    paths: ['~/Library/pnpm/store', '~/Library/Caches/pnpm'],
    priority: 30
  },
  {
    id: 'yarn-cache',
    label: 'yarn cache',
    category: 'package-manager-caches',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'yarn packages may download again on the next install.',
    kind: 'absolute-path',
    paths: ['~/Library/Caches/Yarn'],
    priority: 30
  },
  {
    id: 'bun-cache',
    label: 'bun cache',
    category: 'package-manager-caches',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'bun packages may download again on the next install.',
    kind: 'absolute-path',
    paths: ['~/.bun/install/cache'],
    priority: 30
  },
  {
    id: 'library-caches',
    label: 'Library/Caches children',
    category: 'macos-user-caches-logs',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'User-level macOS caches are removed permanently.',
    kind: 'absolute-children',
    paths: ['~/Library/Caches'],
    priority: 15,
    excludeChildrenByName: ['pnpm', 'Yarn']
  },
  {
    id: 'library-logs',
    label: 'Library/Logs children',
    category: 'macos-user-caches-logs',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'User-level macOS logs are removed permanently.',
    kind: 'absolute-children',
    paths: ['~/Library/Logs'],
    priority: 15
  },
  {
    id: 'xcode-derived-data',
    label: 'Xcode DerivedData',
    category: 'xcode-derived-data',
    scopes: ['global'],
    presets: ['aggressive'],
    deletionMethod: 'permanent',
    warning: 'Xcode will rebuild DerivedData on the next build.',
    kind: 'absolute-children',
    paths: ['~/Library/Developer/Xcode/DerivedData'],
    priority: 20
  }
];

export function getPresetMeta(preset: Preset): PresetMeta {
  return PRESET_META[preset];
}

export function getCategoryMeta(category: Category): CategoryMeta {
  return CATEGORY_META[category];
}

export function getDefaultPreset(): Preset {
  return 'full';
}

export function getDefaultScope(): Scope {
  return 'local';
}

export function getAvailableCategoriesForScope(scope: Scope): Category[] {
  return CATEGORY_VALUES.filter((category) => {
    return TARGET_DEFINITIONS.some((definition) => definition.scopes.includes(scope) && definition.category === category);
  });
}

export function getEnabledCategoriesForPreset(preset: Preset, scope?: Scope): Category[] {
  const categories = PRESET_META[preset].categories.slice();
  if (!scope) {
    return categories;
  }

  const available = new Set(getAvailableCategoriesForScope(scope));
  return categories.filter((category) => available.has(category));
}

export function getDefinitionsForSelection(scope: Scope, enabledCategories: Category[]): TargetDefinition[] {
  return TARGET_DEFINITIONS.filter((definition) => {
    return definition.scopes.includes(scope) && enabledCategories.includes(definition.category);
  });
}

export function getDefaultGlobalRootCandidates(homeDir = os.homedir()): string[] {
  return uniquePaths([
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Developer'),
    path.join(homeDir, 'Code'),
    path.join(homeDir, 'Sites'),
    path.join(homeDir, 'Projects'),
    path.join(homeDir, 'Workspace'),
    path.join(homeDir, 'Workspaces')
  ]);
}

export async function getExistingGlobalRoots(homeDir = os.homedir()): Promise<string[]> {
  const roots = await Promise.all(
    getDefaultGlobalRootCandidates(homeDir).map(async (candidate) => {
      return (await pathExists(candidate)) ? candidate : null;
    })
  );

  return roots.filter((value): value is string => Boolean(value));
}

export function getRuntimeDefaults(): RuntimeDefaults {
  return {
    cwd: process.cwd(),
    homeDir: os.homedir(),
    platform: process.platform,
    isInteractive: Boolean(process.stdout.isTTY)
  };
}

export function resolveAbsoluteDefinitionPaths(definition: TargetDefinition, homeDir: string): string[] {
  return (definition.paths ?? []).map((candidate) => path.resolve(expandHome(candidate, homeDir)));
}

export function assertSupportedPlatform(platform: NodeJS.Platform): void {
  if (platform !== 'darwin') {
    throw new Error('Cleany currently supports macOS only.');
  }
}

export function getAllPresets(): PresetMeta[] {
  return PRESET_VALUES.map((preset) => PRESET_META[preset]);
}

export function getAllCategories(): CategoryMeta[] {
  return CATEGORY_VALUES.map((category) => CATEGORY_META[category]);
}
