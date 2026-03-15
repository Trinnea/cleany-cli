import {describe, expect, test} from 'vitest';
import {buildCleanupPlan} from '../src/core/plan.js';
import {getEnabledCategoriesForPreset} from '../src/core/registry.js';

describe('registry helpers', () => {
  test('filters aggressive categories to local-safe categories', () => {
    expect(getEnabledCategoriesForPreset('aggressive', 'local')).toEqual([
      'node-modules',
      'build-artifacts',
      'project-caches',
      'logs-temp'
    ]);
  });
});

describe('buildCleanupPlan', () => {
  test('respects deselection and no-trash override', () => {
    const plan = buildCleanupPlan({
      preset: 'full',
      enabledCategories: ['node-modules', 'build-artifacts'],
      deselectedKeys: ['/repo/.next'],
      noTrash: true,
      scanResult: {
        candidates: [
          {
            key: '/repo/node_modules',
            definitionId: 'node-modules-dir',
            label: 'node_modules',
            category: 'node-modules',
            path: '/repo/node_modules',
            size: 100,
            deletionMethod: 'trash',
            warning: 'Dependencies will be reinstalled.',
            priority: 10
          },
          {
            key: '/repo/.next',
            definitionId: 'next-dir',
            label: '.next',
            category: 'build-artifacts',
            path: '/repo/.next',
            size: 40,
            deletionMethod: 'trash',
            warning: 'Build output will be recreated.',
            priority: 10
          }
        ],
        warnings: [],
        rootsScanned: [],
        durationMs: 0
      }
    });

    expect(plan.selected).toHaveLength(1);
    expect(plan.selected[0]?.deletionMethod).toBe('permanent');
    expect(plan.totalBytes).toBe(100);
    expect(plan.byMethod.trash).toBe(0);
    expect(plan.byMethod.permanent).toBe(100);
  });
});
