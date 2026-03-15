import path from 'node:path';
import {readdir, lstat} from 'node:fs/promises';
import fg from 'fast-glob';
import {
  getDefinitionsForSelection,
  getExistingGlobalRoots,
  resolveAbsoluteDefinitionPaths
} from './registry.js';
import type {
  Category,
  ScanCandidate,
  ScanProgress,
  ScanResult,
  ScanWarning,
  Scope,
  TargetDefinition
} from '../types.js';
import {normalizeForCompare, pathExists, uniquePaths} from '../utils/paths.js';

const COMMON_IGNORES = ['**/.git/**', '**/.Trash/**', '**/Library/**', '**/Applications/**'];
const NESTED_NODE_MODULES_IGNORE = ['**/node_modules/**'];

export interface ScanRequest {
  scope: Scope;
  basePath: string;
  homeDir: string;
  enabledCategories: Category[];
  onProgress?: (progress: ScanProgress) => void;
}

interface ScanTask {
  definition: TargetDefinition;
  type: 'root-glob' | 'absolute-path' | 'absolute-children';
  root?: string;
  absolutePath?: string;
}

export async function scanTargets(request: ScanRequest): Promise<ScanResult> {
  const startedAt = Date.now();
  const warnings: ScanWarning[] = [];
  const candidateMap = new Map<string, ScanCandidate>();
  const definitions = getDefinitionsForSelection(request.scope, request.enabledCategories);
  const globalRoots = request.scope === 'global' ? await getExistingGlobalRoots(request.homeDir) : [];
  const roots = request.scope === 'local' ? [path.resolve(request.basePath)] : globalRoots;
  const tasks = buildTasks(definitions, roots, request.homeDir);

  if (tasks.length === 0) {
    return {
      candidates: [],
      warnings,
      rootsScanned: roots,
      durationMs: Date.now() - startedAt
    };
  }

  let current = 0;
  for (const task of tasks) {
    current += 1;
    request.onProgress?.({
      stage: 'scan',
      current,
      total: tasks.length,
      message: describeTask(task)
    });

    const foundPaths = await runTask(task, request.scope, warnings);
    for (const foundPath of foundPaths) {
      const normalizedPath = normalizeForCompare(foundPath);
      const candidate = await buildCandidate(task.definition, normalizedPath, warnings);
      if (!candidate) {
        continue;
      }

      const existing = candidateMap.get(normalizedPath);
      if (!existing || candidate.priority >= existing.priority) {
        candidateMap.set(normalizedPath, candidate);
      }
    }
  }

  return {
    candidates: Array.from(candidateMap.values()).sort((left, right) => right.size - left.size || left.path.localeCompare(right.path)),
    warnings,
    rootsScanned: uniquePaths([
      ...roots,
      ...tasks.map((task) => task.absolutePath).filter((value): value is string => Boolean(value))
    ]),
    durationMs: Date.now() - startedAt
  };
}

function buildTasks(definitions: TargetDefinition[], roots: string[], homeDir: string): ScanTask[] {
  const tasks: ScanTask[] = [];

  for (const definition of definitions) {
    if (definition.kind === 'glob-directory' || definition.kind === 'glob-file') {
      for (const root of roots) {
        tasks.push({definition, type: 'root-glob', root});
      }
      continue;
    }

    const absolutePaths = resolveAbsoluteDefinitionPaths(definition, homeDir);
    for (const absolutePath of absolutePaths) {
      tasks.push({
        definition,
        type: definition.kind === 'absolute-children' ? 'absolute-children' : 'absolute-path',
        absolutePath
      });
    }
  }

  return tasks;
}

function describeTask(task: ScanTask): string {
  if (task.type === 'root-glob') {
    return `Scanning ${task.definition.label} in ${task.root}`;
  }

  return `Scanning ${task.definition.label} in ${task.absolutePath}`;
}

async function runTask(task: ScanTask, scope: Scope, warnings: ScanWarning[]): Promise<string[]> {
  if (task.type === 'absolute-path') {
    return (await pathExists(task.absolutePath!)) ? [task.absolutePath!] : [];
  }

  if (task.type === 'absolute-children') {
    return listImmediateChildren(task.absolutePath!, task.definition, warnings);
  }

  return runGlobTask(task.definition, task.root!, scope, warnings);
}

async function runGlobTask(
  definition: TargetDefinition,
  root: string,
  scope: Scope,
  warnings: ScanWarning[]
): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const ignore = definition.category === 'node-modules'
    ? COMMON_IGNORES
    : [...COMMON_IGNORES, ...NESTED_NODE_MODULES_IGNORE];

  try {
    const matches = await fg(definition.patterns ?? [], {
      cwd: root,
      absolute: true,
      dot: true,
      onlyDirectories: definition.kind === 'glob-directory',
      onlyFiles: definition.kind === 'glob-file',
      followSymbolicLinks: false,
      suppressErrors: true,
      unique: true,
      ignore,
      deep: scope === 'local' ? undefined : 8
    });

    if (definition.id === 'node-modules-dir') {
      return matches.filter((candidate) => !isNestedInsideNamedDirectory(candidate, 'node_modules'));
    }

    return matches;
  } catch (error) {
    warnings.push({
      code: 'other',
      message: error instanceof Error ? error.message : String(error),
      path: root
    });
    return [];
  }
}

function isNestedInsideNamedDirectory(candidate: string, directoryName: string): boolean {
  const parentSegments = path.dirname(candidate).split(path.sep).filter(Boolean);
  return parentSegments.includes(directoryName);
}

async function listImmediateChildren(
  absolutePath: string,
  definition: TargetDefinition,
  warnings: ScanWarning[]
): Promise<string[]> {
  if (!(await pathExists(absolutePath))) {
    return [];
  }

  try {
    const entries = await readdir(absolutePath, {withFileTypes: true});
    return entries
      .filter((entry) => !definition.excludeChildrenByName?.includes(entry.name))
      .map((entry) => path.join(absolutePath, entry.name));
  } catch (error) {
    warnings.push(createWarning(error, absolutePath));
    return [];
  }
}

async function buildCandidate(
  definition: TargetDefinition,
  absolutePath: string,
  warnings: ScanWarning[]
): Promise<ScanCandidate | null> {
  try {
    const size = await getPathSize(absolutePath);
    if (size <= 0) {
      return null;
    }

    return {
      key: absolutePath,
      definitionId: definition.id,
      label: definition.label,
      category: definition.category,
      path: absolutePath,
      size,
      deletionMethod: definition.deletionMethod,
      warning: definition.warning,
      priority: definition.priority ?? 0
    };
  } catch (error) {
    warnings.push(createWarning(error, absolutePath));
    return null;
  }
}

async function getPathSize(inputPath: string): Promise<number> {
  const stats = await lstat(inputPath);
  if (stats.isSymbolicLink()) {
    return 0;
  }

  if (stats.isFile()) {
    return stats.size;
  }

  if (!stats.isDirectory()) {
    return stats.size;
  }

  let total = stats.size;
  const entries = await readdir(inputPath, {withFileTypes: true});
  for (const entry of entries) {
    const childPath = path.join(inputPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    total += await getPathSize(childPath);
  }

  return total;
}

function createWarning(error: unknown, targetPath: string): ScanWarning {
  if (error && typeof error === 'object' && 'code' in error) {
    const errorCode = String((error as NodeJS.ErrnoException).code ?? '');
    if (errorCode === 'EACCES' || errorCode === 'EPERM') {
      return {
        code: 'permission-denied',
        message: `Permission denied while scanning ${targetPath}`,
        path: targetPath
      };
    }

    if (errorCode === 'ENOENT') {
      return {
        code: 'missing',
        message: `Path disappeared during scan: ${targetPath}`,
        path: targetPath
      };
    }
  }

  return {
    code: 'other',
    message: error instanceof Error ? error.message : String(error),
    path: targetPath
  };
}
