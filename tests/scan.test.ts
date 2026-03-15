import path from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {scanTargets} from '../src/core/scan.js';
import {cleanupTempDir, createTempDir, writeFixtureDir, writeFixtureFile, writeSymlink} from './helpers.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => cleanupTempDir(dir)));
});

describe('scanTargets', () => {
  test('finds local project artifacts and skips symlink loops', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFixtureFile(root, 'app/node_modules/pkg/index.js', 'console.log("x")');
    await writeFixtureFile(root, 'app/.next/cache/output.txt', 'next-build');
    await writeFixtureFile(root, 'app/.eslintcache', 'cache');
    await writeFixtureDir(root, 'app/linked');
    await writeSymlink(root, 'app/linked/node_modules-link', path.join(root, 'app/node_modules'));

    const result = await scanTargets({
      scope: 'local',
      basePath: root,
      homeDir: root,
      enabledCategories: ['node-modules', 'build-artifacts', 'project-caches', 'logs-temp']
    });

    const candidatePaths = result.candidates.map((candidate) => path.relative(root, candidate.path)).sort();
    expect(candidatePaths).toContain('app/.eslintcache');
    expect(candidatePaths).toContain('app/.next');
    expect(candidatePaths).toContain('app/node_modules');
    expect(candidatePaths.filter((candidate) => candidate.endsWith('node_modules'))).toEqual(['app/node_modules']);
    expect(candidatePaths.some((candidate) => candidate.includes('node_modules-link'))).toBe(false);
  });

  test('finds aggressive global targets from curated home paths', async () => {
    const homeDir = await createTempDir('cleany-home-');
    tempDirs.push(homeDir);
    await writeFixtureFile(homeDir, 'Documents/repo/node_modules/pkg/index.js', 'console.log("y")');
    await writeFixtureFile(homeDir, 'Library/Caches/AppCache/cache.db', 'cache-data');
    await writeFixtureFile(homeDir, 'Library/Developer/Xcode/DerivedData/MyApp/Build/data.bin', 'derived');

    const result = await scanTargets({
      scope: 'global',
      basePath: homeDir,
      homeDir,
      enabledCategories: [
        'node-modules',
        'build-artifacts',
        'project-caches',
        'logs-temp',
        'package-manager-caches',
        'xcode-derived-data',
        'macos-user-caches-logs'
      ]
    });

    const found = result.candidates.map((candidate) => candidate.path);
    expect(found.some((candidate) => candidate.endsWith(path.join('Documents', 'repo', 'node_modules')))).toBe(true);
    expect(found.some((candidate) => candidate.endsWith(path.join('Library', 'Caches', 'AppCache')))).toBe(true);
    expect(found.some((candidate) => candidate.endsWith(path.join('Library', 'Developer', 'Xcode', 'DerivedData', 'MyApp')))).toBe(true);
  });

  test('limits global node-only scans to node_modules targets', async () => {
    const homeDir = await createTempDir('cleany-home-');
    tempDirs.push(homeDir);
    await writeFixtureFile(homeDir, 'Documents/repo/node_modules/pkg/index.js', 'console.log("y")');
    await writeFixtureFile(homeDir, 'Library/Caches/AppCache/cache.db', 'cache-data');

    const result = await scanTargets({
      scope: 'global',
      basePath: homeDir,
      homeDir,
      enabledCategories: ['node-modules']
    });

    const found = result.candidates.map((candidate) => path.relative(homeDir, candidate.path)).sort();
    expect(found).toEqual(['Documents/repo/node_modules']);
  });
});
