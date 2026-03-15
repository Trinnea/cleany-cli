import {afterEach, describe, expect, test} from 'vitest';
import {runHeadless} from '../src/core/headless.js';
import {cleanupTempDir, createTempDir, writeFixtureFile} from './helpers.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => cleanupTempDir(dir)));
});

describe('runHeadless', () => {
  test('returns a JSON preview for dry-run cleanup', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFixtureFile(root, 'repo/node_modules/pkg/index.js', 'console.log("z")');

    const result = await runHeadless(
      {
        intent: 'clean',
        scope: 'local',
        mode: 'node-modules',
        path: root,
        dryRun: true,
        json: true
      },
      {
        cwd: root,
        homeDir: root,
        platform: 'darwin',
        isInteractive: false
      }
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.output);
    expect(payload.scope).toBe('local');
    expect(payload.plan.selected).toHaveLength(1);
  });

  test('requires --yes for headless cleanup', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFixtureFile(root, 'repo/node_modules/pkg/index.js', 'console.log("z")');

    const result = await runHeadless(
      {
        intent: 'clean',
        scope: 'local',
        mode: 'node-modules',
        path: root,
        json: false
      },
      {
        cwd: root,
        homeDir: root,
        platform: 'darwin',
        isInteractive: false
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('--yes');
  });
});
