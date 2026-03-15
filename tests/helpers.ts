import path from 'node:path';
import os from 'node:os';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';

export async function createTempDir(prefix = 'cleany-test-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, {recursive: true, force: true});
}

export async function writeFixtureFile(root: string, relativePath: string, contents: string): Promise<string> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, contents);
  return target;
}

export async function writeFixtureDir(root: string, relativePath: string): Promise<string> {
  const target = path.join(root, relativePath);
  await mkdir(target, {recursive: true});
  return target;
}

export async function writeSymlink(root: string, relativePath: string, target: string): Promise<string> {
  const linkPath = path.join(root, relativePath);
  await mkdir(path.dirname(linkPath), {recursive: true});
  await symlink(target, linkPath);
  return linkPath;
}
