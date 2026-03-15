import os from 'node:os';
import path from 'node:path';
import {access, constants} from 'node:fs/promises';

export function expandHome(inputPath: string, homeDir = os.homedir()): string {
  if (inputPath === '~') {
    return homeDir;
  }

  if (inputPath.startsWith('~/')) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

export async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await access(inputPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((item) => path.resolve(item))));
}

export function normalizeForCompare(inputPath: string): string {
  return path.resolve(inputPath);
}
