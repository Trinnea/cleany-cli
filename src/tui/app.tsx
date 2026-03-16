import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import path from 'node:path';
import {executePlan} from '../core/execute.js';
import {
  CATEGORY_META,
  PRESET_META,
  getAllPresets,
  getAvailableCategoriesForScope,
  getDefaultPreset,
  getDefaultScope,
  getEnabledCategoriesForPreset
} from '../core/registry.js';
import {buildCleanupPlan} from '../core/plan.js';
import {scanTargets} from '../core/scan.js';
import type {
  Category,
  CliOptions,
  ExecutionProgress,
  ExecutionResult,
  Preset,
  RuntimeDefaults,
  ScanCandidate,
  ScanProgress,
  ScanResult,
  Scope
} from '../types.js';
import {compactPath, compactPathMiddle, formatBytes, formatDuration, formatMethod, renderBar} from '../utils/format.js';

const PRESETS = getAllPresets();
const SCOPE_OPTIONS: Array<{id: Scope; label: string; description: string}> = [
  {
    id: 'local',
    label: 'Local project',
    description: 'Scan only the current project path or the directory passed with --path.'
  },
  {
    id: 'global',
    label: 'Global developer roots',
    description: 'Scan common workspace folders plus supported cache locations.'
  }
];
const FOCUS_ORDER: FocusSection[] = ['scope', 'preset', 'categories', 'targets', 'actions'];
const FOCUS_SHORTCUTS: Record<string, FocusSection> = {
  '1': 'scope',
  '2': 'preset',
  '3': 'categories',
  '4': 'targets',
  '5': 'actions'
};

type FocusSection = 'scope' | 'preset' | 'categories' | 'targets' | 'actions';
type ActionId = 'scan' | 'rescan' | 'clean' | 'back' | 'confirm-cleanup' | 'quit' | 'exit';
type Tone = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray';
type WorkflowStage = 'setup' | 'categories' | 'review' | 'cleanup';

interface WorkflowStep {
  stage: WorkflowStage;
  step: string;
  title: string;
  summary: string;
  current: boolean;
  complete: boolean;
}

interface StatusModel {
  label: string;
  detail: string;
  tone: Tone;
  progressCurrent: number;
  progressTotal: number;
}

interface ActionMeta {
  id: ActionId;
  label: string;
  hotkey: string;
  description: string;
  disabled?: boolean;
}

interface InputKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
}

interface CleanyAppProps {
  options: CliOptions;
  runtime: RuntimeDefaults;
}

export function CleanyApp({options, runtime}: CleanyAppProps) {
  const {exit} = useApp();
  const [terminalWidth, terminalHeight] = useTerminalSize();
  const [scope, setScope] = useState<Scope>(options.scope ?? getDefaultScope());
  const [preset, setPreset] = useState<Preset>(options.mode ?? getDefaultPreset());
  const [enabledCategories, setEnabledCategories] = useState<Category[]>(() =>
    getEnabledCategoriesForPreset(options.mode ?? getDefaultPreset(), options.scope ?? getDefaultScope())
  );
  const [deselectedKeys, setDeselectedKeys] = useState<string[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [cleanProgress, setCleanProgress] = useState<ExecutionProgress | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'scan' | 'clean' | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [scopeCursor, setScopeCursor] = useState(() => SCOPE_OPTIONS.findIndex((item) => item.id === (options.scope ?? getDefaultScope())));
  const [presetCursor, setPresetCursor] = useState(() =>
    Math.max(0, PRESETS.findIndex((item) => item.id === (options.mode ?? getDefaultPreset())))
  );
  const [categoryCursor, setCategoryCursor] = useState(0);
  const [targetCursor, setTargetCursor] = useState(0);
  const [targetPage, setTargetPage] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const basePath = options.path ?? runtime.cwd;
  const availableCategories = useMemo(() => getAvailableCategoriesForScope(scope), [scope]);

  useEffect(() => {
    const filtered = enabledCategories.filter((category) => availableCategories.includes(category));
    if (filtered.length === enabledCategories.length) {
      return;
    }

    setEnabledCategories(filtered.length > 0 ? filtered : getEnabledCategoriesForPreset(preset, scope));
  }, [availableCategories, enabledCategories, preset, scope]);

  const visibleTargets = useMemo(() => {
    return (scanResult?.candidates ?? []).filter((candidate) => enabledCategories.includes(candidate.category));
  }, [enabledCategories, scanResult]);

  const cleanupPlan = useMemo(() => {
    if (!scanResult) {
      return null;
    }

    return buildCleanupPlan({
      preset,
      enabledCategories,
      deselectedKeys,
      noTrash: options.noTrash,
      scanResult
    });
  }, [deselectedKeys, enabledCategories, options.noTrash, preset, scanResult]);

  const focusSections = useMemo<FocusSection[]>(() => {
    const sections: FocusSection[] = ['scope', 'preset', 'categories'];
    if (scanResult) {
      sections.push('targets');
    }
    sections.push('actions');
    return sections;
  }, [scanResult]);

  const actions = useMemo<ActionMeta[]>(() => {
    if (executionResult) {
      return [
        {
          id: 'rescan',
          label: 'Rescan',
          hotkey: 's',
          description: 'Run a fresh scan with the current scope, preset, and categories.'
        },
        {
          id: 'exit',
          label: 'Exit',
          hotkey: 'q',
          description: 'Close Cleany.'
        }
      ];
    }

    if (busy === 'clean') {
      return [];
    }

    if (confirming) {
      return [
        {
          id: 'confirm-cleanup',
          label: options.dryRun ? 'Run Preview' : 'Confirm Cleanup',
          hotkey: 'x',
          description: options.dryRun
            ? 'Generate a dry-run report for the current selection.'
            : `Delete ${cleanupPlan?.selected.length ?? 0} selected targets.`,
          disabled: !cleanupPlan || cleanupPlan.selected.length === 0
        },
        {
          id: 'back',
          label: 'Back',
          hotkey: 'b',
          description: 'Return to the review screen without deleting anything.'
        },
        {
          id: 'quit',
          label: 'Quit',
          hotkey: 'q',
          description: 'Close Cleany.'
        }
      ];
    }

    if (!scanResult) {
      return [
        {
          id: 'scan',
          label: 'Scan',
          hotkey: 's',
          description: 'Search the selected scope for reclaimable developer files.'
        },
        {
          id: 'quit',
          label: 'Quit',
          hotkey: 'q',
          description: 'Close Cleany.'
        }
      ];
    }

    return [
      {
        id: 'rescan',
        label: 'Rescan',
        hotkey: 's',
        description: 'Run the scan again using the current configuration.'
      },
      {
        id: 'clean',
        label: options.dryRun ? 'Preview Cleanup' : 'Clean Selected',
        hotkey: 'x',
        description: options.dryRun
          ? 'Preview the current selection without deleting anything.'
          : 'Open the cleanup confirmation step.',
        disabled: !cleanupPlan || cleanupPlan.selected.length === 0
      },
      {
        id: 'quit',
        label: 'Quit',
        hotkey: 'q',
        description: 'Close Cleany.'
      }
    ];
  }, [busy, cleanupPlan, confirming, executionResult, options.dryRun, scanResult]);

  const activeFocus = focusSections[Math.min(focusIndex, focusSections.length - 1)] ?? 'scope';
  const pageSize = Math.max(4, Math.min(10, terminalHeight - 22));
  const totalTargetPages = Math.max(1, Math.ceil(visibleTargets.length / pageSize));
  const pagedTargets = visibleTargets.slice(targetPage * pageSize, targetPage * pageSize + pageSize);
  const focusedCategory = availableCategories[categoryCursor];
  const focusedTarget = pagedTargets[targetCursor];
  const highlightedAction = actions[actionIndex];
  const selectionCount = cleanupPlan?.selected.length ?? 0;
  const scanWarnings = scanResult?.warnings ?? [];
  const prominentWarnings = cleanupPlan?.warnings ?? [];
  const focusHelp = getFocusHelp({
    activeFocus,
    page: targetPage + 1,
    totalPages: totalTargetPages,
    selectionCount,
    targetCount: visibleTargets.length
  });
  const activeStage = getWorkflowStage(activeFocus);
  const workflowSteps = getWorkflowSteps({
    activeStage,
    scope,
    preset,
    enabledCategoryCount: enabledCategories.length,
    availableCategoryCount: availableCategories.length,
    scanResult,
    selectionCount,
    visibleTargetCount: visibleTargets.length,
    confirming,
    executionResult
  });
  const statusModel = getStatusModel({
    scanProgress,
    cleanProgress,
    busy,
    confirming,
    executionResult,
    scanResult,
    cleanupPlan
  });

  useEffect(() => {
    setScopeCursor(Math.max(0, SCOPE_OPTIONS.findIndex((item) => item.id === scope)));
  }, [scope]);

  useEffect(() => {
    setPresetCursor(Math.max(0, PRESETS.findIndex((item) => item.id === preset)));
  }, [preset]);

  useEffect(() => {
    setTargetPage((current) => Math.min(current, totalTargetPages - 1));
  }, [totalTargetPages]);

  useEffect(() => {
    setTargetCursor((current) => Math.min(current, Math.max(0, pagedTargets.length - 1)));
    setActionIndex((current) => Math.min(current, Math.max(0, actions.length - 1)));
    setCategoryCursor((current) => Math.min(current, Math.max(0, availableCategories.length - 1)));
  }, [actions.length, availableCategories.length, pagedTargets.length]);

  useInput((input, key) => {
    if (busy) {
      return;
    }

    if (key.tab) {
      setFocusIndex((current) => (current + 1) % focusSections.length);
      return;
    }

    const shortcutSection = FOCUS_SHORTCUTS[input];
    if (shortcutSection && focusSections.includes(shortcutSection)) {
      setFocusIndex(focusSections.indexOf(shortcutSection));
      return;
    }

    const hotkeyAction = actions.find((action) => action.hotkey === input && !action.disabled);
    if (hotkeyAction) {
      void runAction(hotkeyAction.id);
      return;
    }

    if (key.escape && confirming) {
      setConfirming(false);
      setFocusIndex(FOCUS_ORDER.indexOf('targets'));
      return;
    }

    if ((input === 'p' || input === 'h' || key.leftArrow || key.pageUp) && activeFocus === 'targets' && targetPage > 0) {
      setTargetPage((current) => current - 1);
      setTargetCursor(0);
      return;
    }

    if ((input === 'n' || input === 'l' || key.rightArrow || key.pageDown) && activeFocus === 'targets' && targetPage < totalTargetPages - 1) {
      setTargetPage((current) => current + 1);
      setTargetCursor(0);
      return;
    }

    switch (activeFocus) {
      case 'scope':
        handleScopeInput(input, key, scopeCursor, setScopeCursor, setScopeWithReset);
        break;
      case 'preset':
        handlePresetInput(input, key, presetCursor, setPresetCursor, setPresetSelection);
        break;
      case 'categories':
        handleCategoriesInput(input, key);
        break;
      case 'targets':
        handleTargetsInput(input, key);
        break;
      case 'actions':
        handleActionsInput(input, key);
        break;
    }
  });

  function setScopeWithReset(nextScope: Scope) {
    if (nextScope === scope) {
      return;
    }

    setScope(nextScope);
    setEnabledCategories(getEnabledCategoriesForPreset(preset, nextScope));
    setScanResult(null);
    setExecutionResult(null);
    setConfirming(false);
    setDeselectedKeys([]);
    setTargetCursor(0);
    setTargetPage(0);
  }

  function setPresetSelection(nextIndex: number) {
    const nextPreset = PRESETS[nextIndex]?.id ?? preset;

    if (nextPreset === preset) {
      return;
    }

    setPreset(nextPreset);
    setEnabledCategories(getEnabledCategoriesForPreset(nextPreset, scope));
    setScanResult(null);
    setExecutionResult(null);
    setDeselectedKeys([]);
    setConfirming(false);
    setTargetCursor(0);
    setTargetPage(0);
  }

  function handleCategoriesInput(input: string, key: InputKey) {
    if (key.downArrow || input === 'j') {
      setCategoryCursor((current) => Math.min(current + 1, availableCategories.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setCategoryCursor((current) => Math.max(current - 1, 0));
      return;
    }

    if (input === ' ' || key.return) {
      const category = availableCategories[categoryCursor];
      if (!category) {
        return;
      }

      setEnabledCategories((current) => {
        const exists = current.includes(category);
        if (exists) {
          return current.filter((item) => item !== category);
        }

        return [...current, category];
      });
      setScanResult(null);
      setExecutionResult(null);
      setDeselectedKeys([]);
      setConfirming(false);
      setTargetCursor(0);
      setTargetPage(0);
    }
  }

  function handleTargetsInput(input: string, key: InputKey) {
    if (key.downArrow || input === 'j') {
      setTargetCursor((current) => Math.min(current + 1, Math.max(0, pagedTargets.length - 1)));
      return;
    }

    if (key.upArrow || input === 'k') {
      setTargetCursor((current) => Math.max(current - 1, 0));
      return;
    }

    if (input === ' ' || key.return) {
      const target = pagedTargets[targetCursor];
      if (!target) {
        return;
      }

      setDeselectedKeys((current) => {
        const exists = current.includes(target.key);
        if (exists) {
          return current.filter((item) => item !== target.key);
        }

        return [...current, target.key];
      });
    }
  }

  function handleActionsInput(input: string, key: InputKey) {
    if (key.downArrow || key.rightArrow || input === 'j' || input === 'l') {
      setActionIndex((current) => Math.min(current + 1, Math.max(0, actions.length - 1)));
      return;
    }

    if (key.upArrow || key.leftArrow || input === 'k' || input === 'h') {
      setActionIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (key.return || input === ' ') {
      void runAction(actions[actionIndex]?.id);
    }
  }

  async function runAction(actionId?: ActionId) {
    if (!actionId) {
      return;
    }

    switch (actionId) {
      case 'quit':
      case 'exit':
        exit();
        return;
      case 'scan':
      case 'rescan':
        await runScan();
        return;
      case 'clean':
        if (cleanupPlan && cleanupPlan.selected.length > 0) {
          setConfirming(true);
          setActionIndex(0);
          setFocusIndex(FOCUS_ORDER.indexOf('actions'));
        }
        return;
      case 'back':
        setConfirming(false);
        setFocusIndex(FOCUS_ORDER.indexOf(scanResult ? 'targets' : 'categories'));
        return;
      case 'confirm-cleanup':
        await runCleanup();
        return;
    }
  }

  async function runScan() {
    setBusy('scan');
    setExecutionResult(null);
    setConfirming(false);
    setDeselectedKeys([]);
    setTargetCursor(0);
    setTargetPage(0);
    try {
      const nextScanResult = await scanTargets({
        scope,
        basePath,
        homeDir: runtime.homeDir,
        enabledCategories,
        onProgress: setScanProgress
      });
      setScanResult(nextScanResult);
      setFocusIndex(FOCUS_ORDER.indexOf('targets'));
    } finally {
      setBusy(null);
      setScanProgress(null);
    }
  }

  async function runCleanup() {
    if (!cleanupPlan) {
      return;
    }

    setBusy('clean');
    setConfirming(false);
    try {
      const result = await executePlan({
        targets: cleanupPlan.selected,
        dryRun: options.dryRun,
        onProgress: setCleanProgress
      });
      setExecutionResult(result);
      setFocusIndex(FOCUS_ORDER.indexOf('actions'));
    } finally {
      setBusy(null);
      setCleanProgress(null);
    }
  }

  return (
    <Box flexDirection="column" width={terminalWidth} height={terminalHeight} paddingX={1}>
      <Hero basePath={basePath} activeStage={activeStage} workflowSteps={workflowSteps} />
      <Box flexGrow={1} gap={1}>
        <Box width="68%" flexDirection="column" gap={1}>
          <WorkflowCard
            step="01"
            title="Setup"
            hint="Choose where to scan and how aggressive the cleanup should be."
            stateLabel={`${scope === 'local' ? 'Local' : 'Global'} · ${PRESET_META[preset].label}`}
            active={activeStage === 'setup'}
            tone="green"
          >
            <Text color="gray">[1] Scope · all available options are listed below</Text>
            {SCOPE_OPTIONS.map((option, index) => (
              <ChoiceRow
                key={option.id}
                label={option.label}
                description={
                  option.id === 'local'
                    ? `${option.description} Current path ${compactPath(basePath, 36)}.`
                    : option.description
                }
                selected={scope === option.id}
                cursor={activeFocus === 'scope' && index === scopeCursor}
              />
            ))}
            <Text color="gray">[2] Preset · all available modes are listed below</Text>
            {PRESETS.map((item, index) => (
              <ChoiceRow
                key={item.id}
                label={PRESET_META[item.id].label}
                description={PRESET_META[item.id].description}
                selected={preset === item.id}
                cursor={activeFocus === 'preset' && index === presetCursor}
              />
            ))}
          </WorkflowCard>
          <WorkflowCard
            step="02"
            title="Fine-tune categories"
            hint="Enable only the artifact groups you want Cleany to touch."
            stateLabel={`${enabledCategories.length}/${availableCategories.length} enabled`}
            active={activeStage === 'categories'}
            tone="yellow"
          >
            {availableCategories.map((category, index) => {
              const total = cleanupPlan?.categoryTotals[category] ?? 0;
              return (
                <SelectableRow
                  key={category}
                  label={CATEGORY_META[category].label}
                  selected={enabledCategories.includes(category)}
                  cursor={activeFocus === 'categories' && index === categoryCursor}
                  detail={scanResult ? formatBytes(total) : undefined}
                />
              );
            })}
            <Text color="gray">
              {focusedCategory ? compactPath(CATEGORY_META[focusedCategory].description, 70) : 'Choose what Cleany is allowed to touch.'}
            </Text>
          </WorkflowCard>
          <WorkflowCard
            step="03"
            title="Review scan results"
            hint={scanResult ? 'Inspect what will be removed. Toggle any item you want to keep.' : 'Run a scan after setup to populate review items.'}
            stateLabel={
              scanResult
                ? `${selectionCount}/${visibleTargets.length} selected${visibleTargets.length > pageSize ? ` · page ${targetPage + 1}/${totalTargetPages}` : ''}`
                : 'Waiting for scan'
            }
            active={activeStage === 'review'}
            tone="magenta"
          >
            {pagedTargets.length === 0 ? (
              <Text color="gray">Press `s` to scan using the current setup and category selection.</Text>
            ) : (
              pagedTargets.map((target, index) => {
                const isSelected = !deselectedKeys.includes(target.key);
                return (
                  <SelectableRow
                    key={target.key}
                    label={formatTargetLabel(target, scope, basePath, runtime.homeDir)}
                    selected={isSelected}
                    cursor={activeFocus === 'targets' && index === targetCursor}
                    detail={`${formatBytes(target.size)} ${formatMethod(options.noTrash ? 'permanent' : target.deletionMethod)}`}
                  />
                );
              })
            )}
            {focusedTarget ? (
              <Text color="gray">{compactPath(focusedTarget.warning, 72)}</Text>
            ) : (
              <Text color="gray">{focusHelp}</Text>
            )}
          </WorkflowCard>
          <WorkflowCard
            step="04"
            title={confirming ? 'Confirm cleanup' : executionResult ? 'Cleanup complete' : 'Run cleanup'}
            hint={
              confirming
                ? 'One more explicit step before anything is deleted.'
                : executionResult
                  ? 'Rescan if you want to check the next batch.'
                  : 'Start with a scan, then continue when the selection looks right.'
            }
            stateLabel={
              executionResult
                ? `Reclaimed ${formatBytes(executionResult.bytesReclaimed)}`
                : confirming
                  ? `${selectionCount} selected`
                  : highlightedAction?.label ?? 'Ready'
            }
            active={activeStage === 'cleanup'}
            tone="blue"
          >
            {actions.map((action, index) => (
              <ActionRow
                key={action.id}
                action={action}
                active={activeFocus === 'actions' && index === actionIndex}
              />
            ))}
            <Text color="gray">
              {executionResult
                ? `Removed ${executionResult.deleted.length} targets in the last run.`
                : highlightedAction
                  ? compactPath(highlightedAction.description, 72)
                  : 'Choose an action to continue.'}
            </Text>
          </WorkflowCard>
        </Box>
        <Box width="32%" flexDirection="column" gap={1}>
          <SideCard title="Status" subtitle={statusModel.label} tone={statusModel.tone}>
            <Text>{compactPath(statusModel.detail, 36)}</Text>
            <Text color={busy ? 'cyan' : 'gray'}>
              {renderBar(statusModel.progressCurrent, statusModel.progressTotal || 1, 18)}{' '}
              {statusModel.progressTotal > 0 ? `${statusModel.progressCurrent}/${statusModel.progressTotal}` : 'idle'}
            </Text>
          </SideCard>
          <SideCard title="Snapshot" subtitle="Current selection" tone="cyan">
            <MetricRow label="Scope" value={scope === 'local' ? 'Local' : 'Global'} />
            <MetricRow label="Preset" value={PRESET_META[preset].label} />
            <MetricRow label="Selected" value={String(selectionCount)} />
            <MetricRow label="Reclaimable" value={formatBytes(cleanupPlan?.totalBytes ?? 0)} />
            <MetricRow label="Trash" value={formatBytes(cleanupPlan?.byMethod.trash ?? 0)} />
            <MetricRow label="Permanent" value={formatBytes(cleanupPlan?.byMethod.permanent ?? 0)} />
          </SideCard>
          <SideCard title="Workflow" subtitle="Guided path" tone="magenta">
            {workflowSteps.map((step) => (
              <TimelineRow key={step.stage} step={step} />
            ))}
          </SideCard>
          <SideCard title="Keys" subtitle="Fast path" tone="gray">
            <Text color="gray">[1-5] Jump [Tab] Next [j/k] Move</Text>
            <Text color="gray">[Space] Toggle [Enter] Apply / Select</Text>
            <Text color="gray">[s] Scan [x] Clean [b] Back [q] Quit</Text>
            {scanResult ? <Text color="gray">[n/p] Pages</Text> : null}
          </SideCard>
          <SideCard title="Warnings" subtitle={confirming ? 'Review carefully' : 'Before cleanup'} tone="red">
            {renderWarningRows(confirming ? buildConfirmWarnings(cleanupPlan) : prominentWarnings, 3)}
            {scanWarnings.length > 0 ? (
              <Text color="yellow">+ {scanWarnings.length} scan warnings recorded</Text>
            ) : (
              <Text color="gray">No active warnings.</Text>
            )}
          </SideCard>
        </Box>
      </Box>
    </Box>
  );
}

function handleScopeInput(
  input: string,
  key: InputKey,
  currentCursor: number,
  setCursor: React.Dispatch<React.SetStateAction<number>>,
  onSelect: (scope: Scope) => void
) {
  if (key.downArrow || key.rightArrow || input === 'j' || input === 'l') {
    setCursor((current) => Math.min(current + 1, SCOPE_OPTIONS.length - 1));
    return;
  }

  if (key.upArrow || key.leftArrow || input === 'k' || input === 'h') {
    setCursor((current) => Math.max(current - 1, 0));
    return;
  }

  if (key.return || input === ' ') {
    const nextScope = SCOPE_OPTIONS[currentCursor]?.id;
    if (nextScope) {
      onSelect(nextScope);
    }
  }
}

function handlePresetInput(
  input: string,
  key: InputKey,
  currentIndex: number,
  setCursor: React.Dispatch<React.SetStateAction<number>>,
  onSelect: (index: number) => void
) {
  if (key.downArrow || key.rightArrow || input === 'j' || input === 'l') {
    setCursor((current) => Math.min(current + 1, PRESETS.length - 1));
    return;
  }

  if (key.upArrow || key.leftArrow || input === 'k' || input === 'h') {
    setCursor((current) => Math.max(current - 1, 0));
    return;
  }

  if (key.return || input === ' ') {
    onSelect(currentIndex);
  }
}

function Hero({
  basePath,
  activeStage,
  workflowSteps
}: {
  basePath: string;
  activeStage: WorkflowStage;
  workflowSteps: WorkflowStep[];
}) {
  const currentStep = workflowSteps.find((step) => step.stage === activeStage);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} paddingY={0} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color="magenta">Cleany</Text>
        <Text color="gray">{currentStep ? `Step ${currentStep.step} of ${workflowSteps.length}` : ''}</Text>
      </Box>
      <Text>{compactPath(basePath, 88)}</Text>
      <Text color="gray">Configure, scan, review, and clean without hidden navigation.</Text>
    </Box>
  );
}

function Card({
  title,
  subtitle,
  active,
  tone = 'cyan',
  children
}: {
  title: string;
  subtitle?: string;
  active: boolean;
  tone?: Tone;
  children: React.ReactNode;
}) {
  const borderColor = active ? tone : 'gray';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={0}>
      <Text color={borderColor}>{title}</Text>
      {subtitle ? <Text color="gray">{compactPath(subtitle, 64)}</Text> : null}
      {children}
    </Box>
  );
}

function WorkflowCard({
  step,
  title,
  hint,
  stateLabel,
  active,
  tone,
  children
}: {
  step: string;
  title: string;
  hint: string;
  stateLabel: string;
  active: boolean;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <Card title={`Step ${step}`} subtitle={stateLabel} active={active} tone={tone}>
      <Text color={active ? tone : 'white'}>{title}</Text>
      <Text color="gray">{compactPath(hint, 76)}</Text>
      {children}
    </Card>
  );
}

function SideCard({
  title,
  subtitle,
  tone,
  children
}: {
  title: string;
  subtitle?: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <Card title={title} subtitle={subtitle} active={false} tone={tone}>
      {children}
    </Card>
  );
}

function SelectableRow({label, selected, cursor, detail}: {label: string; selected: boolean; cursor: boolean; detail?: string}) {
  const color = cursor ? 'cyan' : selected ? 'green' : 'white';

  return (
    <Box justifyContent="space-between">
      <Text color={color}>
        {cursor ? '>' : ' '} {selected ? '[x]' : '[ ]'} {label}
      </Text>
      {detail ? <Text color={cursor ? 'cyan' : 'gray'}>{compactPath(detail, 20)}</Text> : null}
    </Box>
  );
}

function ChoiceRow({
  label,
  description,
  selected,
  cursor
}: {
  label: string;
  description: string;
  selected: boolean;
  cursor: boolean;
}) {
  const titleColor = cursor ? 'cyan' : selected ? 'green' : 'white';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={titleColor}>
        {cursor ? '>' : ' '} {selected ? '[x]' : '[ ]'} {label}
      </Text>
      <Text color="gray">{description}</Text>
    </Box>
  );
}

function ActionRow({action, active}: {action: ActionMeta; active: boolean}) {
  const color = action.disabled ? 'gray' : active ? 'blue' : 'white';

  return (
    <Box flexDirection="column">
      <Text color={color}>
        {active ? '>' : ' '} [{action.hotkey}] {action.label}
        {action.disabled ? ' (unavailable)' : ''}
      </Text>
      <Text color="gray">{compactPath(action.description, 60)}</Text>
    </Box>
  );
}

function MetricRow({label, value}: {label: string; value: string}) {
  return (
    <Box justifyContent="space-between">
      <Text color="gray">{label}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

function TimelineRow({step}: {step: WorkflowStep}) {
  const marker = step.current ? '>' : step.complete ? 'x' : '-';
  const color = step.current ? 'cyan' : step.complete ? 'green' : 'gray';

  return (
    <Box flexDirection="column">
      <Text color={color}>
        {marker} {step.step}. {step.title}
      </Text>
      <Text color="gray">{compactPath(step.summary, 34)}</Text>
    </Box>
  );
}

function renderWarningRows(warnings: string[], limit: number) {
  if (warnings.length === 0) {
    return <Text color="gray">Warnings will appear here before cleanup.</Text>;
  }

  const rows = warnings.slice(0, limit).map((warning) => (
    <Text key={warning} color="yellow">
      - {compactPath(warning, 70)}
    </Text>
  ));

  if (warnings.length > limit) {
    rows.push(
      <Text key="more" color="yellow">
        - +{warnings.length - limit} more warnings
      </Text>
    );
  }

  return rows;
}

function buildConfirmWarnings(cleanupPlan: ReturnType<typeof buildCleanupPlan> | null): string[] {
  if (!cleanupPlan) {
    return [];
  }

  return [
    `Selected targets: ${cleanupPlan.selected.length}`,
    `Total reclaimable: ${formatBytes(cleanupPlan.totalBytes)}`,
    `Trash: ${formatBytes(cleanupPlan.byMethod.trash)}`,
    `Permanent delete: ${formatBytes(cleanupPlan.byMethod.permanent)}`,
    ...cleanupPlan.warnings
  ];
}

function formatTargetLabel(target: ScanCandidate, scope: Scope, basePath: string, homeDir: string): string {
  const anchor = scope === 'local' ? basePath : homeDir;
  const relativePath = path.relative(anchor, target.path) || path.basename(target.path);
  return compactPathMiddle(relativePath, 44);
}

function getWorkflowStage(activeFocus: FocusSection): WorkflowStage {
  switch (activeFocus) {
    case 'scope':
    case 'preset':
      return 'setup';
    case 'categories':
      return 'categories';
    case 'targets':
      return 'review';
    case 'actions':
      return 'cleanup';
  }
}

function getWorkflowSteps({
  activeStage,
  scope,
  preset,
  enabledCategoryCount,
  availableCategoryCount,
  scanResult,
  selectionCount,
  visibleTargetCount,
  confirming,
  executionResult
}: {
  activeStage: WorkflowStage;
  scope: Scope;
  preset: Preset;
  enabledCategoryCount: number;
  availableCategoryCount: number;
  scanResult: ScanResult | null;
  selectionCount: number;
  visibleTargetCount: number;
  confirming: boolean;
  executionResult: ExecutionResult | null;
}): WorkflowStep[] {
  return [
    {
      stage: 'setup',
      step: '1',
      title: 'Setup',
      summary: `${scope === 'local' ? 'Local' : 'Global'} · ${PRESET_META[preset].label}`,
      current: activeStage === 'setup',
      complete: true
    },
    {
      stage: 'categories',
      step: '2',
      title: 'Categories',
      summary: `${enabledCategoryCount}/${availableCategoryCount} enabled`,
      current: activeStage === 'categories',
      complete: enabledCategoryCount > 0
    },
    {
      stage: 'review',
      step: '3',
      title: 'Review',
      summary: scanResult ? `${selectionCount}/${visibleTargetCount} selected` : 'Run scan',
      current: activeStage === 'review',
      complete: Boolean(scanResult)
    },
    {
      stage: 'cleanup',
      step: '4',
      title: 'Cleanup',
      summary: executionResult ? 'Completed' : confirming ? 'Waiting for confirm' : 'Ready',
      current: activeStage === 'cleanup',
      complete: Boolean(executionResult)
    }
  ];
}

function getStatusModel({
  scanProgress,
  cleanProgress,
  busy,
  confirming,
  executionResult,
  scanResult,
  cleanupPlan
}: {
  scanProgress: ScanProgress | null;
  cleanProgress: ExecutionProgress | null;
  busy: 'scan' | 'clean' | null;
  confirming: boolean;
  executionResult: ExecutionResult | null;
  scanResult: ScanResult | null;
  cleanupPlan: ReturnType<typeof buildCleanupPlan> | null;
}): StatusModel {
  const progress = busy === 'scan' ? scanProgress : cleanProgress;
  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;

  if (busy === 'scan' && scanProgress) {
    return {
      label: 'Scanning',
      detail: scanProgress.message,
      tone: 'cyan',
      progressCurrent: current,
      progressTotal: total
    };
  }

  if (busy === 'clean' && cleanProgress) {
    return {
      label: 'Cleaning',
      detail: compactPath(cleanProgress.targetPath, 80),
      tone: 'cyan',
      progressCurrent: current,
      progressTotal: total
    };
  }

  if (confirming) {
    return {
      label: 'Awaiting confirmation',
      detail: `${cleanupPlan?.selected.length ?? 0} targets for ${formatBytes(cleanupPlan?.totalBytes ?? 0)}.`,
      tone: 'yellow',
      progressCurrent: 0,
      progressTotal: 0
    };
  }

  if (executionResult) {
    return {
      label: 'Cleanup finished',
      detail: `Reclaimed ${formatBytes(executionResult.bytesReclaimed)} from ${executionResult.deleted.length} targets.`,
      tone: 'green',
      progressCurrent: 0,
      progressTotal: 0
    };
  }

  if (scanResult) {
    return {
      label: 'Scan complete',
      detail: `${scanResult.candidates.length} targets across ${scanResult.rootsScanned.length} roots in ${formatDuration(scanResult.durationMs)}.`,
      tone: 'green',
      progressCurrent: 0,
      progressTotal: 0
    };
  }

  return {
    label: 'Ready',
    detail: 'Choose setup, then run a scan.',
    tone: 'gray',
    progressCurrent: 0,
    progressTotal: 0
  };
}

function getFocusHelp({
  activeFocus,
  page,
  totalPages,
  selectionCount,
  targetCount
}: {
  activeFocus: FocusSection;
  page: number;
  totalPages: number;
  selectionCount: number;
  targetCount: number;
}) {
  switch (activeFocus) {
    case 'scope':
      return 'Move to a scope option, then press Enter to apply it.';
    case 'preset':
      return 'Preview presets with the cursor, then press Enter to apply one.';
    case 'categories':
      return 'Enable or disable categories before scanning.';
    case 'targets':
      return `${selectionCount} selected across ${targetCount} targets. Page ${page}/${totalPages}.`;
    case 'actions':
      return 'Global action keys work without moving focus here.';
  }
}

function useTerminalSize(): [number, number] {
  const [size, setSize] = useState<[number, number]>([process.stdout.columns ?? 120, process.stdout.rows ?? 36]);

  useEffect(() => {
    const onResize = () => {
      setSize([process.stdout.columns ?? 120, process.stdout.rows ?? 36]);
    };

    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
