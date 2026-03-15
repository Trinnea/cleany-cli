import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import path from 'node:path';
import {buildCleanupPlan} from '../core/plan.js';
import {executePlan} from '../core/execute.js';
import {getAllCategories, getAllPresets, getAvailableCategoriesForScope, getDefaultPreset, getDefaultScope, getEnabledCategoriesForPreset} from '../core/registry.js';
import {scanTargets} from '../core/scan.js';
import type {Category, CliOptions, ExecutionProgress, ExecutionResult, RuntimeDefaults, ScanProgress, ScanResult, Scope, Preset, ScanCandidate} from '../types.js';
import {compactPath, compactPathMiddle, formatBytes, formatMethod, renderBar} from '../utils/format.js';

const PRESETS = getAllPresets();
const CATEGORIES = getAllCategories();

type FocusSection = 'scope' | 'preset' | 'categories' | 'targets' | 'actions';
type ActionId = 'scan' | 'rescan' | 'clean' | 'back' | 'confirm-cleanup' | 'quit' | 'exit';

interface ActionMeta {
  id: ActionId;
  label: string;
  disabled?: boolean;
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
  const [enabledCategories, setEnabledCategories] = useState<Category[]>(() => getEnabledCategoriesForPreset(options.mode ?? getDefaultPreset(), options.scope ?? getDefaultScope()));
  const [deselectedKeys, setDeselectedKeys] = useState<string[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [cleanProgress, setCleanProgress] = useState<ExecutionProgress | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'scan' | 'clean' | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [presetIndex, setPresetIndex] = useState(() => Math.max(0, PRESETS.findIndex((item) => item.id === (options.mode ?? getDefaultPreset()))));
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
        {id: 'exit', label: 'Exit'},
        {id: 'rescan', label: 'Rescan'}
      ];
    }

    if (busy === 'clean') {
      return [];
    }

    if (confirming) {
      return [
        {id: 'back', label: 'Back'},
        {id: 'confirm-cleanup', label: options.dryRun ? 'Run Dry Preview' : 'Confirm Cleanup', disabled: !cleanupPlan || cleanupPlan.selected.length === 0},
        {id: 'quit', label: 'Quit'}
      ];
    }

    if (!scanResult) {
      return [
        {id: 'scan', label: 'Scan'},
        {id: 'quit', label: 'Quit'}
      ];
    }

    return [
      {id: 'rescan', label: 'Rescan'},
      {id: 'clean', label: options.dryRun ? 'Preview Cleanup' : 'Clean Selected', disabled: !cleanupPlan || cleanupPlan.selected.length === 0},
      {id: 'quit', label: 'Quit'}
    ];
  }, [busy, cleanupPlan, confirming, executionResult, options.dryRun]);

  const activeFocus = focusSections[Math.min(focusIndex, focusSections.length - 1)] ?? 'scope';
  const pageSize = Math.max(4, Math.min(8, terminalHeight - 18));
  const totalTargetPages = Math.max(1, Math.ceil(visibleTargets.length / pageSize));
  const pagedTargets = visibleTargets.slice(targetPage * pageSize, targetPage * pageSize + pageSize);

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

    if (input === 'q' && !confirming) {
      exit();
      return;
    }

    if (key.escape && confirming) {
      setConfirming(false);
      return;
    }

    if (key.tab) {
      setFocusIndex((current) => (current + 1) % focusSections.length);
      return;
    }

    if ((input === 'p' || key.leftArrow) && activeFocus === 'targets' && targetPage > 0) {
      setTargetPage((current) => current - 1);
      setTargetCursor(0);
      return;
    }

    if ((input === 'n' || key.rightArrow) && activeFocus === 'targets' && targetPage < totalTargetPages - 1) {
      setTargetPage((current) => current + 1);
      setTargetCursor(0);
      return;
    }

    switch (activeFocus) {
      case 'scope':
        handleScopeInput(input, key, scope, setScopeWithReset);
        break;
      case 'preset':
        handlePresetInput(input, key, presetIndex, setPresetSelection);
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
    setScope(nextScope);
    setEnabledCategories(getEnabledCategoriesForPreset(preset, nextScope));
    setScanResult(null);
    setExecutionResult(null);
    setConfirming(false);
    setDeselectedKeys([]);
  }

  function setPresetSelection(nextIndex: number) {
    const nextPreset = PRESETS[nextIndex]?.id ?? preset;
    setPresetIndex(nextIndex);
    setPreset(nextPreset);
    setEnabledCategories(getEnabledCategoriesForPreset(nextPreset, scope));
    setScanResult(null);
    setExecutionResult(null);
    setDeselectedKeys([]);
    setConfirming(false);
  }

  function handleCategoriesInput(input: string, key: {upArrow?: boolean; downArrow?: boolean; return?: boolean}) {
    if (key.downArrow) {
      setCategoryCursor((current) => Math.min(current + 1, availableCategories.length - 1));
      return;
    }

    if (key.upArrow) {
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
    }
  }

  function handleTargetsInput(input: string, key: {upArrow?: boolean; downArrow?: boolean; return?: boolean}) {
    if (key.downArrow) {
      setTargetCursor((current) => Math.min(current + 1, Math.max(0, pagedTargets.length - 1)));
      return;
    }

    if (key.upArrow) {
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

  function handleActionsInput(input: string, key: {leftArrow?: boolean; rightArrow?: boolean; return?: boolean}) {
    if (key.rightArrow) {
      setActionIndex((current) => Math.min(current + 1, Math.max(0, actions.length - 1)));
      return;
    }

    if (key.leftArrow) {
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
        }
        return;
      case 'back':
        setConfirming(false);
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
    try {
      const nextScanResult = await scanTargets({
        scope,
        basePath,
        homeDir: runtime.homeDir,
        enabledCategories,
        onProgress: setScanProgress
      });
      setScanResult(nextScanResult);
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
    } finally {
      setBusy(null);
      setCleanProgress(null);
    }
  }

  const scanWarnings = scanResult?.warnings ?? [];
  const prominentWarnings = cleanupPlan?.warnings ?? [];
  const selectionCount = cleanupPlan?.selected.length ?? 0;

  return (
    <Box flexDirection="column" width={terminalWidth} height={terminalHeight} paddingX={1}>
      <Header scope={scope} preset={preset} basePath={basePath} cleanupPlan={cleanupPlan} busy={busy} executionResult={executionResult} />
      <StatusPanel scanProgress={scanProgress} cleanProgress={cleanProgress} busy={busy} />
      <Box flexGrow={1} gap={1}>
        <Box width="34%" flexDirection="column" gap={1}>
          <Section title="Scope" active={activeFocus === 'scope'}>
            <SelectableRow label="Local" selected={scope === 'local'} cursor={activeFocus === 'scope' && scope === 'local'} />
            <SelectableRow label="Global" selected={scope === 'global'} cursor={activeFocus === 'scope' && scope === 'global'} />
            <Text color="gray">{scope === 'local' ? compactPath(basePath, 30) : 'Developer roots + explicit cache paths'}</Text>
          </Section>
          <Section title="Presets" active={activeFocus === 'preset'}>
            {PRESETS.map((item, index) => (
              <SelectableRow
                key={item.id}
                label={getPresetShortLabel(item.id)}
                selected={preset === item.id}
                cursor={activeFocus === 'preset' && index === presetIndex}
              />
            ))}
            <Text color="gray">{compactPath(PRESETS[presetIndex]?.description ?? '', 28)}</Text>
          </Section>
        </Box>
        <Box width="33%" flexDirection="column" gap={1}>
          <Section title="Categories" active={activeFocus === 'categories'}>
            {availableCategories.map((category, index) => {
              const meta = CATEGORIES.find((item) => item.id === category)!;
              const total = cleanupPlan?.categoryTotals[category] ?? 0;
              return (
                <SelectableRow
                  key={category}
                  label={getCategoryShortLabel(category)}
                  selected={enabledCategories.includes(category)}
                  cursor={activeFocus === 'categories' && index === categoryCursor}
                  detail={scanResult ? formatBytes(total) : undefined}
                />
              );
            })}
          </Section>
          <Section title="Warnings" active={false}>
            {renderWarningRows(confirming ? buildConfirmWarnings(cleanupPlan) : prominentWarnings, terminalWidth < 120 ? 2 : 4)}
            {scanWarnings.length > 0 ? <Text color="yellow">+ {scanWarnings.length} scan warnings</Text> : <Text color="gray">No scan warnings</Text>}
          </Section>
        </Box>
        <Box width="33%" flexDirection="column" gap={1}>
          <Section title="Targets" active={activeFocus === 'targets'}>
            {pagedTargets.length === 0 ? (
              <Text color="gray">Run a scan to review individual folders and files.</Text>
            ) : (
              pagedTargets.map((target, index) => {
                const isSelected = !deselectedKeys.includes(target.key);
                return (
                  <SelectableRow
                    key={target.key}
                    label={formatTargetLabel(target, scope, basePath, runtime.homeDir)}
                    selected={isSelected}
                    cursor={activeFocus === 'targets' && index === targetCursor}
                    detail={`${formatBytes(target.size)} · ${formatMethod(options.noTrash ? 'permanent' : target.deletionMethod)}`}
                  />
                );
              })
            )}
            {visibleTargets.length > pageSize ? <Text color="gray">Page {targetPage + 1}/{totalTargetPages} · n next · p prev</Text> : null}
          </Section>
          <Section title={confirming ? 'Confirm' : executionResult ? 'Done' : 'Actions'} active={activeFocus === 'actions'}>
            <Box gap={1} flexWrap="wrap">
              {actions.map((action, index) => (
                <ActionChip key={action.id} label={action.label} active={activeFocus === 'actions' && index === actionIndex} disabled={action.disabled} />
              ))}
            </Box>
            <Text color="gray">Tab focus · Space toggle · Enter select · n/p pages · q quit</Text>
            <Text color="gray">Selected: {selectionCount} targets · Trash {formatBytes(cleanupPlan?.byMethod.trash ?? 0)} · Permanent {formatBytes(cleanupPlan?.byMethod.permanent ?? 0)}</Text>
            {executionResult ? <Text color="green">Reclaimed {formatBytes(executionResult.bytesReclaimed)} from {executionResult.deleted.length} targets.</Text> : null}
          </Section>
        </Box>
      </Box>
    </Box>
  );
}

function handleScopeInput(
  input: string,
  key: {leftArrow?: boolean; rightArrow?: boolean; return?: boolean},
  scope: Scope,
  onSelect: (scope: Scope) => void
) {
  if (key.leftArrow || key.rightArrow || key.return || input === ' ') {
    onSelect(scope === 'local' ? 'global' : 'local');
  }
}

function handlePresetInput(
  input: string,
  key: {leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; return?: boolean},
  currentIndex: number,
  onSelect: (index: number) => void
) {
  if (key.downArrow || key.rightArrow) {
    onSelect(Math.min(currentIndex + 1, PRESETS.length - 1));
    return;
  }

  if (key.upArrow || key.leftArrow) {
    onSelect(Math.max(currentIndex - 1, 0));
    return;
  }

  if (key.return || input === ' ') {
    onSelect(currentIndex);
  }
}

function Header({
  scope,
  preset,
  basePath,
  cleanupPlan,
  busy,
  executionResult
}: {
  scope: Scope;
  preset: Preset;
  basePath: string;
  cleanupPlan: ReturnType<typeof buildCleanupPlan> | null;
  busy: 'scan' | 'clean' | null;
  executionResult: ExecutionResult | null;
}) {
  const titleColor = busy ? 'cyan' : executionResult ? 'green' : 'magenta';
  return (
    <Section title="Cleany CLI" active={false}>
      <Text color={titleColor}>macOS developer cleanup</Text>
      <Text>{compactPath(basePath, 64)}</Text>
      <Text color="gray">Scope {scope} · Preset {preset} · Reclaimable {formatBytes(cleanupPlan?.totalBytes ?? 0)}</Text>
    </Section>
  );
}

function StatusPanel({
  scanProgress,
  cleanProgress,
  busy
}: {
  scanProgress: ScanProgress | null;
  cleanProgress: ExecutionProgress | null;
  busy: 'scan' | 'clean' | null;
}) {
  const progress = busy === 'scan' ? scanProgress : cleanProgress;
  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  let label = 'Ready';
  if (busy === 'scan' && scanProgress) {
    label = scanProgress.message;
  } else if (busy === 'clean' && cleanProgress) {
    label = `Deleting ${cleanProgress.targetPath}`;
  }

  return (
    <Section title="Status" active={false}>
      <Text>{label}</Text>
      <Text color={busy ? 'cyan' : 'gray'}>{renderBar(current, total || 1, 30)} {total > 0 ? `${current}/${total}` : '0/0'}</Text>
    </Section>
  );
}

function Section({title, active, children}: {title: string; active: boolean; children: React.ReactNode}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={active ? 'cyan' : 'gray'} paddingX={1} paddingY={0}>
      <Text color={active ? 'cyan' : 'gray'}>{title}</Text>
      {children}
    </Box>
  );
}

function SelectableRow({label, selected, cursor, detail}: {label: string; selected: boolean; cursor: boolean; detail?: string}) {
  return (
    <Box justifyContent="space-between">
      <Text color={cursor ? 'cyan' : selected ? 'green' : 'white'}>{cursor ? '>' : ' '} {selected ? '[x]' : '[ ]'} {label}</Text>
      {detail ? <Text color="gray">{compactPath(detail, 18)}</Text> : null}
    </Box>
  );
}

function ActionChip({label, active, disabled}: {label: string; active: boolean; disabled?: boolean}) {
  const color = disabled ? 'gray' : active ? 'black' : 'cyan';
  const backgroundColor = disabled ? undefined : active ? 'cyan' : undefined;
  return <Text color={color} backgroundColor={backgroundColor}> {label} </Text>;
}

function renderWarningRows(warnings: string[], limit: number) {
  if (warnings.length === 0) {
    return <Text color="gray">Warnings will appear here before cleanup.</Text>;
  }

  const rows = warnings.slice(0, limit).map((warning) => <Text key={warning} color="yellow">- {compactPath(warning, 70)}</Text>);
  if (warnings.length > limit) {
    rows.push(<Text key="more" color="yellow">- +{warnings.length - limit} more warnings</Text>);
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

function getPresetShortLabel(preset: Preset): string {
  switch (preset) {
    case 'node-modules':
      return 'Node Only';
    case 'build':
      return 'Build';
    case 'caches':
      return 'Caches';
    case 'aggressive':
      return 'Aggressive';
    default:
      return 'Full';
  }
}

function getCategoryShortLabel(category: Category): string {
  switch (category) {
    case 'node-modules':
      return 'Node Modules';
    case 'build-artifacts':
      return 'Build Artifacts';
    case 'project-caches':
      return 'Project Caches';
    case 'logs-temp':
      return 'Logs / Temp';
    case 'package-manager-caches':
      return 'Pkg Caches';
    case 'xcode-derived-data':
      return 'Xcode DD';
    case 'macos-user-caches-logs':
      return 'macOS Cache/Logs';
  }
}

function useTerminalSize(): [number, number] {
  const [size, setSize] = useState<[number, number]>([
    process.stdout.columns ?? 120,
    process.stdout.rows ?? 36
  ]);

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
