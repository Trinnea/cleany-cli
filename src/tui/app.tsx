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
  {id: 'local', label: 'Local project', description: 'Current directory or --path only'},
  {id: 'global', label: 'Global roots', description: 'Common workspaces and supported caches'}
];
const SECTION_ORDER: SectionId[] = ['scope', 'preset', 'categories', 'targets', 'actions'];
const SECTION_SHORTCUTS: Record<string, SectionId> = {
  '1': 'scope',
  '2': 'preset',
  '3': 'categories',
  '4': 'targets',
  '5': 'actions'
};

type SectionId = 'scope' | 'preset' | 'categories' | 'targets' | 'actions';
type ActionId = 'scan' | 'rescan' | 'clean' | 'back' | 'confirm-cleanup' | 'quit' | 'exit';
type Tone = 'green' | 'yellow' | 'cyan' | 'gray' | 'white';

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
  const [section, setSection] = useState<SectionId>('scope');
  const [scopeCursor, setScopeCursor] = useState(() => Math.max(0, SCOPE_OPTIONS.findIndex((item) => item.id === (options.scope ?? getDefaultScope()))));
  const [presetCursor, setPresetCursor] = useState(() =>
    Math.max(0, PRESETS.findIndex((item) => item.id === (options.mode ?? getDefaultPreset())))
  );
  const [categoryCursor, setCategoryCursor] = useState(0);
  const [targetCursor, setTargetCursor] = useState(0);
  const [actionCursor, setActionCursor] = useState(0);
  const basePath = options.path ?? runtime.cwd;
  const availableCategories = useMemo(() => getAvailableCategoriesForScope(scope), [scope]);
  const terminal = useMemo(() => getTerminalModel(terminalWidth, terminalHeight), [terminalHeight, terminalWidth]);

  useEffect(() => {
    const filtered = enabledCategories.filter((category) => availableCategories.includes(category));
    if (filtered.length !== enabledCategories.length) {
      setEnabledCategories(filtered.length > 0 ? filtered : getEnabledCategoriesForPreset(preset, scope));
    }
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

  const actions = useMemo<ActionMeta[]>(() => {
    if (executionResult) {
      return [
        {id: 'rescan', label: 'Rescan', hotkey: 's', description: 'Run a fresh scan.'},
        {id: 'exit', label: 'Exit', hotkey: 'q', description: 'Close Cleany.'}
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
          description: options.dryRun ? 'Preview selected deletions.' : `Delete ${cleanupPlan?.selected.length ?? 0} selected targets.`,
          disabled: !cleanupPlan || cleanupPlan.selected.length === 0
        },
        {id: 'back', label: 'Back', hotkey: 'b', description: 'Return to review.'},
        {id: 'quit', label: 'Quit', hotkey: 'q', description: 'Close Cleany.'}
      ];
    }

    if (!scanResult) {
      return [
        {id: 'scan', label: 'Scan', hotkey: 's', description: 'Find reclaimable developer files.'},
        {id: 'quit', label: 'Quit', hotkey: 'q', description: 'Close Cleany.'}
      ];
    }

    return [
      {id: 'rescan', label: 'Rescan', hotkey: 's', description: 'Scan again with the current choices.'},
      {
        id: 'clean',
        label: options.dryRun ? 'Preview Cleanup' : 'Clean Selected',
        hotkey: 'x',
        description: options.dryRun ? 'Preview without deleting.' : 'Open final confirmation.',
        disabled: !cleanupPlan || cleanupPlan.selected.length === 0
      },
      {id: 'quit', label: 'Quit', hotkey: 'q', description: 'Close Cleany.'}
    ];
  }, [busy, cleanupPlan, confirming, executionResult, options.dryRun, scanResult]);

  const availableSections = useMemo<SectionId[]>(() => {
    return scanResult ? SECTION_ORDER : ['scope', 'preset', 'categories', 'actions'];
  }, [scanResult]);

  const activeSection = availableSections.includes(section) ? section : 'actions';
  const selectedCount = cleanupPlan?.selected.length ?? 0;
  const reclaimableBytes = cleanupPlan?.totalBytes ?? 0;
  const status = getStatus({
    busy,
    scanProgress,
    cleanProgress,
    confirming,
    executionResult,
    scanResult
  });
  const maxRows = Math.max(1, terminal.bodyRows);
  const targetRows = Math.max(1, maxRows - 2);
  const targetWindow = getWindow(visibleTargets.length, targetCursor, targetRows);
  const targetPage = Math.floor(targetCursor / targetRows) + 1;
  const totalTargetPages = Math.max(1, Math.ceil(visibleTargets.length / targetRows));
  const focusedCategory = availableCategories[categoryCursor];
  const focusedTarget = visibleTargets[targetCursor];
  const focusedAction = actions[actionCursor];

  useEffect(() => {
    if (!availableSections.includes(section)) {
      setSection('actions');
    }
  }, [availableSections, section]);

  useEffect(() => {
    setScopeCursor(Math.max(0, SCOPE_OPTIONS.findIndex((item) => item.id === scope)));
  }, [scope]);

  useEffect(() => {
    setPresetCursor(Math.max(0, PRESETS.findIndex((item) => item.id === preset)));
  }, [preset]);

  useEffect(() => {
    setCategoryCursor((current) => clamp(current, 0, Math.max(0, availableCategories.length - 1)));
  }, [availableCategories.length]);

  useEffect(() => {
    setTargetCursor((current) => clamp(current, 0, Math.max(0, visibleTargets.length - 1)));
  }, [visibleTargets.length]);

  useEffect(() => {
    setActionCursor((current) => clamp(current, 0, Math.max(0, actions.length - 1)));
  }, [actions.length]);

  useInput((input, key) => {
    if (busy) {
      return;
    }

    if (key.escape && confirming) {
      setConfirming(false);
      setSection(scanResult ? 'targets' : 'actions');
      return;
    }

    const hotkeyAction = actions.find((action) => action.hotkey === input && !action.disabled);
    if (hotkeyAction) {
      void runAction(hotkeyAction.id);
      return;
    }

    const shortcutSection = SECTION_SHORTCUTS[input];
    if (shortcutSection) {
      setSection(resolveSection(shortcutSection, availableSections));
      return;
    }

    if (key.tab) {
      setSection(nextSection(activeSection, availableSections, 1));
      return;
    }

    if (key.leftArrow && activeSection !== 'targets') {
      setSection(nextSection(activeSection, availableSections, -1));
      return;
    }

    if (key.rightArrow && activeSection !== 'targets') {
      setSection(nextSection(activeSection, availableSections, 1));
      return;
    }

    switch (activeSection) {
      case 'scope':
        handleScopeInput(input, key);
        return;
      case 'preset':
        handlePresetInput(input, key);
        return;
      case 'categories':
        handleCategoryInput(input, key);
        return;
      case 'targets':
        handleTargetInput(input, key, targetRows);
        return;
      case 'actions':
        handleActionInput(input, key);
        return;
    }
  });

  function resetScanState() {
    setScanResult(null);
    setExecutionResult(null);
    setConfirming(false);
    setDeselectedKeys([]);
    setTargetCursor(0);
    if (section === 'targets') {
      setSection('actions');
    }
  }

  function setScopeSelection(nextScope: Scope) {
    if (nextScope === scope) {
      return;
    }

    setScope(nextScope);
    setEnabledCategories(getEnabledCategoriesForPreset(preset, nextScope));
    resetScanState();
  }

  function setPresetSelection(nextPreset: Preset) {
    if (nextPreset === preset) {
      return;
    }

    setPreset(nextPreset);
    setEnabledCategories(getEnabledCategoriesForPreset(nextPreset, scope));
    resetScanState();
  }

  function handleScopeInput(input: string, key: InputKey) {
    if (key.downArrow || input === 'j') {
      setScopeCursor((current) => clamp(current + 1, 0, SCOPE_OPTIONS.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setScopeCursor((current) => clamp(current - 1, 0, SCOPE_OPTIONS.length - 1));
      return;
    }

    if (input === ' ' || key.return) {
      const nextScope = SCOPE_OPTIONS[scopeCursor]?.id;
      if (nextScope) {
        setScopeSelection(nextScope);
      }
    }
  }

  function handlePresetInput(input: string, key: InputKey) {
    if (key.downArrow || input === 'j') {
      setPresetCursor((current) => clamp(current + 1, 0, PRESETS.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setPresetCursor((current) => clamp(current - 1, 0, PRESETS.length - 1));
      return;
    }

    if (input === ' ' || key.return) {
      const nextPreset = PRESETS[presetCursor]?.id;
      if (nextPreset) {
        setPresetSelection(nextPreset);
      }
    }
  }

  function handleCategoryInput(input: string, key: InputKey) {
    if (key.downArrow || input === 'j') {
      setCategoryCursor((current) => clamp(current + 1, 0, availableCategories.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setCategoryCursor((current) => clamp(current - 1, 0, availableCategories.length - 1));
      return;
    }

    if (input === ' ' || key.return) {
      const category = availableCategories[categoryCursor];
      if (!category) {
        return;
      }

      setEnabledCategories((current) => {
        if (current.includes(category)) {
          return current.filter((item) => item !== category);
        }

        return [...current, category];
      });
      resetScanState();
    }
  }

  function handleTargetInput(input: string, key: InputKey, pageSize: number) {
    if (key.downArrow || input === 'j') {
      setTargetCursor((current) => clamp(current + 1, 0, visibleTargets.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setTargetCursor((current) => clamp(current - 1, 0, visibleTargets.length - 1));
      return;
    }

    if (key.pageDown || key.rightArrow || input === 'n' || input === 'l') {
      setTargetCursor((current) => clamp(current + pageSize, 0, visibleTargets.length - 1));
      return;
    }

    if (key.pageUp || key.leftArrow || input === 'p' || input === 'h') {
      setTargetCursor((current) => clamp(current - pageSize, 0, visibleTargets.length - 1));
      return;
    }

    if (input === ' ' || key.return) {
      const target = visibleTargets[targetCursor];
      if (!target) {
        return;
      }

      setDeselectedKeys((current) => {
        if (current.includes(target.key)) {
          return current.filter((item) => item !== target.key);
        }

        return [...current, target.key];
      });
    }
  }

  function handleActionInput(input: string, key: InputKey) {
    if (key.downArrow || input === 'j') {
      setActionCursor((current) => clamp(current + 1, 0, actions.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setActionCursor((current) => clamp(current - 1, 0, actions.length - 1));
      return;
    }

    if (input === ' ' || key.return) {
      void runAction(actions[actionCursor]?.id);
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
          setActionCursor(0);
          setSection('actions');
        }
        return;
      case 'back':
        setConfirming(false);
        setSection(scanResult ? 'targets' : 'actions');
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
    try {
      const nextScanResult = await scanTargets({
        scope,
        basePath,
        homeDir: runtime.homeDir,
        enabledCategories,
        onProgress: setScanProgress
      });
      setScanResult(nextScanResult);
      setSection('targets');
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
      setSection('actions');
    } finally {
      setBusy(null);
      setCleanProgress(null);
    }
  }

  return (
    <Box flexDirection="column" width={terminal.width} minHeight={terminal.height} paddingX={terminal.paddingX}>
      <Header
        basePath={basePath}
        compact={terminal.compact}
        status={status}
        width={terminal.contentWidth}
      />
      <SummaryBar
        compact={terminal.compact}
        scope={scope}
        preset={preset}
        categoryCount={enabledCategories.length}
        availableCategoryCount={availableCategories.length}
        selectedCount={selectedCount}
        visibleTargetCount={visibleTargets.length}
        reclaimableBytes={reclaimableBytes}
        durationMs={scanResult?.durationMs}
        width={terminal.contentWidth}
      />
      <SectionTabs active={activeSection} availableSections={availableSections} compact={terminal.compact} />

      <Box flexDirection="column" flexGrow={1} borderStyle={terminal.compact ? undefined : 'round'} borderColor="cyan" paddingX={terminal.compact ? 0 : 1}>
        <SectionHeader activeSection={activeSection} hint={getSectionHint(activeSection, scanResult, targetPage, totalTargetPages)} />
        {activeSection === 'scope' ? (
          <ScopeView
            scope={scope}
            cursor={scopeCursor}
            basePath={basePath}
            maxRows={maxRows}
            width={terminal.contentWidth}
          />
        ) : null}
        {activeSection === 'preset' ? <PresetView preset={preset} cursor={presetCursor} maxRows={maxRows} width={terminal.contentWidth} /> : null}
        {activeSection === 'categories' ? (
          <CategoryView
            availableCategories={availableCategories}
            enabledCategories={enabledCategories}
            cleanupPlan={cleanupPlan}
            cursor={categoryCursor}
            maxRows={maxRows}
            focusedCategory={focusedCategory}
            width={terminal.contentWidth}
          />
        ) : null}
        {activeSection === 'targets' ? (
          <TargetView
            targets={visibleTargets}
            window={targetWindow}
            cursor={targetCursor}
            deselectedKeys={deselectedKeys}
            scope={scope}
            basePath={basePath}
            homeDir={runtime.homeDir}
            noTrash={Boolean(options.noTrash)}
            focusedTarget={focusedTarget}
            width={terminal.contentWidth}
          />
        ) : null}
        {activeSection === 'actions' ? (
          <ActionView
            actions={actions}
            cursor={actionCursor}
            confirming={confirming}
            cleanupPlan={cleanupPlan}
            dryRun={Boolean(options.dryRun)}
            cleanProgress={cleanProgress}
            executionResult={executionResult}
            warnings={scanResult?.warnings ?? []}
            maxRows={maxRows}
            width={terminal.contentWidth}
          />
        ) : null}
      </Box>

      <Footer
        compact={terminal.compact}
        activeSection={activeSection}
        canPageTargets={visibleTargets.length > targetRows}
        confirming={confirming}
      />
    </Box>
  );
}

function Header({
  basePath,
  compact,
  status,
  width
}: {
  basePath: string;
  compact: boolean;
  status: {text: string; tone: Tone; progress?: {current: number; total: number}};
  width: number;
}) {
  if (compact) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan">Cleany</Text> <Text color={status.tone}>{truncate(status.text, width - 8)}</Text>
        </Text>
        {status.progress ? <ProgressLine current={status.progress.current} total={status.progress.total} width={width} /> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={status.tone} paddingX={1} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color="cyan">Cleany</Text>
        <Text color={status.tone}>{truncate(status.text, Math.max(12, width - 12))}</Text>
      </Box>
      {status.progress ? (
        <ProgressLine current={status.progress.current} total={status.progress.total} width={width - 4} />
      ) : (
        <Text color="gray">{compactPathMiddle(basePath, Math.max(18, width - 4))}</Text>
      )}
    </Box>
  );
}

function SummaryBar({
  compact,
  scope,
  preset,
  categoryCount,
  availableCategoryCount,
  selectedCount,
  visibleTargetCount,
  reclaimableBytes,
  durationMs,
  width
}: {
  compact: boolean;
  scope: Scope;
  preset: Preset;
  categoryCount: number;
  availableCategoryCount: number;
  selectedCount: number;
  visibleTargetCount: number;
  reclaimableBytes: number;
  durationMs?: number;
  width: number;
}) {
  const longSummary = [
    scope === 'local' ? 'Local' : 'Global',
    PRESET_META[preset].label,
    `${categoryCount}/${availableCategoryCount} categories`,
    `${selectedCount}/${visibleTargetCount} selected`,
    formatBytes(reclaimableBytes),
    durationMs === undefined ? null : formatDuration(durationMs)
  ]
    .filter(Boolean)
    .join(' | ');

  if (compact) {
    return <Text color="gray">{truncate(longSummary, width)}</Text>;
  }

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text>
        <Text color="gray">Scope </Text>
        {scope === 'local' ? 'Local' : 'Global'}
        <Text color="gray"> | Mode </Text>
        {PRESET_META[preset].label}
        <Text color="gray"> | Categories </Text>
        {categoryCount}/{availableCategoryCount}
        <Text color="gray"> | Selected </Text>
        {selectedCount}/{visibleTargetCount}
        <Text color="gray"> | Reclaimable </Text>
        <Text color={reclaimableBytes > 0 ? 'green' : 'gray'}>{formatBytes(reclaimableBytes)}</Text>
        {durationMs === undefined ? null : <Text color="gray"> | Scan {formatDuration(durationMs)}</Text>}
      </Text>
    </Box>
  );
}

function SectionTabs({
  active,
  availableSections,
  compact
}: {
  active: SectionId;
  availableSections: SectionId[];
  compact: boolean;
}) {
  const tabs = SECTION_ORDER.map((sectionId, index) => {
    const available = availableSections.includes(sectionId);
    const selected = active === sectionId;
    return `${selected ? '>' : ' '}${index + 1} ${sectionLabel(sectionId)}${available ? '' : '*'}`;
  }).join(compact ? ' ' : '  ');

  return <Text color="gray">{tabs}</Text>;
}

function SectionHeader({activeSection, hint}: {activeSection: SectionId; hint: string}) {
  return (
    <Box justifyContent="space-between">
      <Text color="cyan">{sectionLabel(activeSection)}</Text>
      <Text color="gray">{hint}</Text>
    </Box>
  );
}

function ScopeView({
  scope,
  cursor,
  basePath,
  maxRows,
  width
}: {
  scope: Scope;
  cursor: number;
  basePath: string;
  maxRows: number;
  width: number;
}) {
  const listRows = Math.max(1, maxRows - 1);
  const window = getWindow(SCOPE_OPTIONS.length, cursor, listRows);

  return (
    <Box flexDirection="column">
      {SCOPE_OPTIONS.slice(window.start, window.end).map((option, index) => (
        <ChoiceRow
          key={option.id}
          cursor={cursor === window.start + index}
          selected={scope === option.id}
          title={option.label}
          detail={option.id === 'local' ? compactPathMiddle(basePath, width - 22) : option.description}
          width={width}
        />
      ))}
      {maxRows > 1 ? <WindowFooter window={window} total={SCOPE_OPTIONS.length} /> : null}
    </Box>
  );
}

function PresetView({preset, cursor, maxRows, width}: {preset: Preset; cursor: number; maxRows: number; width: number}) {
  const listRows = Math.max(1, maxRows - 1);
  const window = getWindow(PRESETS.length, cursor, listRows);

  return (
    <Box flexDirection="column">
      {PRESETS.slice(window.start, window.end).map((item, index) => (
        <ChoiceRow
          key={item.id}
          cursor={cursor === window.start + index}
          selected={preset === item.id}
          title={PRESET_META[item.id].label}
          detail={PRESET_META[item.id].description}
          width={width}
        />
      ))}
      {maxRows > 1 ? <WindowFooter window={window} total={PRESETS.length} /> : null}
    </Box>
  );
}

function CategoryView({
  availableCategories,
  enabledCategories,
  cleanupPlan,
  cursor,
  maxRows,
  focusedCategory,
  width
}: {
  availableCategories: Category[];
  enabledCategories: Category[];
  cleanupPlan: ReturnType<typeof buildCleanupPlan> | null;
  cursor: number;
  maxRows: number;
  focusedCategory?: Category;
  width: number;
}) {
  const listRows = Math.max(1, maxRows - 2);
  const window = getWindow(availableCategories.length, cursor, listRows);

  return (
    <Box flexDirection="column">
      {availableCategories.slice(window.start, window.end).map((category, index) => {
        const actualIndex = window.start + index;
        return (
          <DataRow
            key={category}
            cursor={cursor === actualIndex}
            selected={enabledCategories.includes(category)}
            title={CATEGORY_META[category].label}
            meta={cleanupPlan ? formatBytes(cleanupPlan.categoryTotals[category] ?? 0) : undefined}
            width={width}
          />
        );
      })}
      {maxRows > 1 ? <WindowFooter window={window} total={availableCategories.length} /> : null}
      {maxRows > 2 ? <Hint text={focusedCategory ? CATEGORY_META[focusedCategory].description : 'Toggle categories before scanning.'} width={width} /> : null}
    </Box>
  );
}

function TargetView({
  targets,
  window,
  cursor,
  deselectedKeys,
  scope,
  basePath,
  homeDir,
  noTrash,
  focusedTarget,
  width
}: {
  targets: ScanCandidate[];
  window: ListWindow;
  cursor: number;
  deselectedKeys: string[];
  scope: Scope;
  basePath: string;
  homeDir: string;
  noTrash: boolean;
  focusedTarget?: ScanCandidate;
  width: number;
}) {
  if (targets.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No targets found for the current selection.</Text>
        <Hint text="Change mode or categories, then scan again." width={width} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {targets.slice(window.start, window.end).map((target, index) => {
        const actualIndex = window.start + index;
        const method = noTrash ? 'permanent' : target.deletionMethod;
        return (
          <DataRow
            key={target.key}
            cursor={cursor === actualIndex}
            selected={!deselectedKeys.includes(target.key)}
            title={formatTargetLabel(target, scope, basePath, homeDir, width)}
            meta={`${formatBytes(target.size)} ${formatMethod(method)}`}
            width={width}
          />
        );
      })}
      {window.size > 1 ? <WindowFooter window={window} total={targets.length} /> : null}
      {window.size > 2 ? <Hint text={focusedTarget ? focusedTarget.warning : 'Toggle targets you want to keep.'} width={width} /> : null}
    </Box>
  );
}

function ActionView({
  actions,
  cursor,
  confirming,
  cleanupPlan,
  dryRun,
  cleanProgress,
  executionResult,
  warnings,
  maxRows,
  width
}: {
  actions: ActionMeta[];
  cursor: number;
  confirming: boolean;
  cleanupPlan: ReturnType<typeof buildCleanupPlan> | null;
  dryRun: boolean;
  cleanProgress: ExecutionProgress | null;
  executionResult: ExecutionResult | null;
  warnings: Array<{message: string}>;
  maxRows: number;
  width: number;
}) {
  const warningLimit = Math.max(0, maxRows - actions.length - (confirming ? 2 : 0) - (executionResult ? 2 : 0) - (cleanProgress ? 1 : 0));

  return (
    <Box flexDirection="column">
      {confirming ? <ConfirmBlock cleanupPlan={cleanupPlan} dryRun={dryRun} width={width} /> : null}
      {cleanProgress ? (
        <Text color="cyan">
          Cleaning {cleanProgress.current}/{cleanProgress.total}: {compactPathMiddle(cleanProgress.targetPath, width - 20)}
        </Text>
      ) : null}
      {executionResult ? <ResultBlock result={executionResult} /> : null}
      {actions.length === 0 ? <Text color="gray">Cleaning in progress.</Text> : null}
      {actions.map((action, index) => (
        <ActionRow key={action.id} action={action} cursor={cursor === index} width={width} />
      ))}
      {warningLimit > 0 ? (
        <WarningBlock cleanupWarnings={cleanupPlan?.warnings ?? []} scanWarnings={warnings.map((warning) => warning.message)} limit={warningLimit} width={width} />
      ) : null}
    </Box>
  );
}

function ChoiceRow({
  cursor,
  selected,
  title,
  detail,
  width
}: {
  cursor: boolean;
  selected: boolean;
  title: string;
  detail: string;
  width: number;
}) {
  const color = cursor ? 'cyan' : selected ? 'green' : 'white';
  const marker = `${cursor ? '>' : ' '} ${selected ? '[x]' : '[ ]'} `;
  const detailText = detail ? ` ${detail}` : '';
  const titleWidth = Math.max(8, width - marker.length - detailText.length);

  return (
    <Box justifyContent="space-between">
      <Text color={color}>
        {marker}
        {truncate(title, titleWidth)}
      </Text>
      {detail ? <Text color="gray">{truncate(detail, Math.max(0, width - titleWidth - marker.length))}</Text> : null}
    </Box>
  );
}

function DataRow({
  cursor,
  selected,
  title,
  meta,
  width
}: {
  cursor: boolean;
  selected: boolean;
  title: string;
  meta?: string;
  width: number;
}) {
  const color = cursor ? 'cyan' : selected ? 'green' : 'white';
  const marker = `${cursor ? '>' : ' '} ${selected ? '[x]' : '[ ]'} `;
  const metaText = meta ? ` ${meta}` : '';
  const titleWidth = Math.max(8, width - marker.length - metaText.length);

  return (
    <Box justifyContent="space-between">
      <Text color={color}>
        {marker}
        {truncate(title, titleWidth)}
      </Text>
      {meta ? <Text color={cursor ? 'cyan' : 'gray'}>{truncate(meta, Math.max(0, width - titleWidth - marker.length))}</Text> : null}
    </Box>
  );
}

function ActionRow({action, cursor, width}: {action: ActionMeta; cursor: boolean; width: number}) {
  const color = action.disabled ? 'gray' : cursor ? 'cyan' : 'white';
  const prefix = `${cursor ? '>' : ' '} [${action.hotkey}] `;

  return (
    <Box flexDirection="column">
      <Text color={color}>
        {prefix}
        {truncate(`${action.label}${action.disabled ? ' (unavailable)' : ''}`, width - prefix.length)}
      </Text>
      <Text color="gray">  {truncate(action.description, width - 2)}</Text>
    </Box>
  );
}

function ConfirmBlock({
  cleanupPlan,
  dryRun,
  width
}: {
  cleanupPlan: ReturnType<typeof buildCleanupPlan> | null;
  dryRun: boolean;
  width: number;
}) {
  const summary = `${cleanupPlan?.selected.length ?? 0} targets | ${formatBytes(cleanupPlan?.totalBytes ?? 0)} | Trash ${formatBytes(
    cleanupPlan?.byMethod.trash ?? 0
  )} | Permanent ${formatBytes(cleanupPlan?.byMethod.permanent ?? 0)}`;

  return (
    <Box flexDirection="column">
      <Text color={dryRun ? 'cyan' : 'yellow'}>{dryRun ? 'Dry run preview' : 'Final confirmation required'}</Text>
      <Text>{truncate(summary, width)}</Text>
    </Box>
  );
}

function ResultBlock({result}: {result: ExecutionResult}) {
  return (
    <Box flexDirection="column">
      <Text color="green">Cleanup complete</Text>
      <Text>
        Removed {result.deleted.length} targets, reclaimed {formatBytes(result.bytesReclaimed)}.
      </Text>
      {result.skipped.length > 0 ? <Text color="yellow">Skipped {result.skipped.length} targets.</Text> : null}
    </Box>
  );
}

function WarningBlock({
  cleanupWarnings,
  scanWarnings,
  limit,
  width
}: {
  cleanupWarnings: string[];
  scanWarnings: string[];
  limit: number;
  width: number;
}) {
  const warnings = [...cleanupWarnings, ...scanWarnings].slice(0, Math.max(0, limit - 1));

  if (warnings.length === 0) {
    return <Text color="gray">No warnings for the current selection.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="yellow">Warnings</Text>
      {warnings.map((warning) => (
        <Text key={warning} color="yellow">
          - {truncate(warning, width - 2)}
        </Text>
      ))}
    </Box>
  );
}

function ProgressLine({current, total, width}: {current: number; total: number; width: number}) {
  const barWidth = clamp(Math.floor(width / 3), 8, 28);

  return (
    <Text color="cyan">
      {renderBar(current, total || 1, barWidth)} {current}/{total}
    </Text>
  );
}

function WindowFooter({window, total}: {window: ListWindow; total: number}) {
  if (total <= window.size) {
    return null;
  }

  return (
    <Text color="gray">
      Showing {window.start + 1}-{window.end} of {total}
    </Text>
  );
}

function Hint({text, width}: {text: string; width: number}) {
  return <Text color="gray">{truncate(text, width)}</Text>;
}

function Footer({
  compact,
  activeSection,
  canPageTargets,
  confirming
}: {
  compact: boolean;
  activeSection: SectionId;
  canPageTargets: boolean;
  confirming: boolean;
}) {
  const baseKeys = compact
    ? 'Tab/1-5 switch | jk move | Space/Enter choose | s scan | x clean | q quit'
    : 'Tab or 1-5 switch sections | arrows/jk move | Space/Enter choose | s scan | x clean | q quit';
  const extras = [activeSection === 'targets' && canPageTargets ? 'n/p page' : null, confirming ? 'b/Esc back' : null]
    .filter(Boolean)
    .join(' | ');

  return (
    <Box marginTop={1}>
      <Text color="gray">
        {baseKeys}
        {extras ? ` | ${extras}` : ''}
      </Text>
    </Box>
  );
}

function formatTargetLabel(target: ScanCandidate, scope: Scope, basePath: string, homeDir: string, width: number): string {
  const anchor = scope === 'local' ? basePath : homeDir;
  const relativePath = path.relative(anchor, target.path) || path.basename(target.path);
  return compactPathMiddle(relativePath, Math.max(12, width - 22));
}

function getSectionHint(section: SectionId, scanResult: ScanResult | null, page: number, totalPages: number): string {
  switch (section) {
    case 'scope':
      return 'where to scan';
    case 'preset':
      return 'what to find';
    case 'categories':
      return 'fine tune';
    case 'targets':
      return scanResult ? `page ${page}/${totalPages}` : 'scan first';
    case 'actions':
      return 'run or exit';
  }
}

function getStatus({
  busy,
  scanProgress,
  cleanProgress,
  confirming,
  executionResult,
  scanResult
}: {
  busy: 'scan' | 'clean' | null;
  scanProgress: ScanProgress | null;
  cleanProgress: ExecutionProgress | null;
  confirming: boolean;
  executionResult: ExecutionResult | null;
  scanResult: ScanResult | null;
}): {text: string; tone: Tone; progress?: {current: number; total: number}} {
  if (busy === 'scan' && scanProgress) {
    return {text: scanProgress.message, tone: 'cyan', progress: {current: scanProgress.current, total: scanProgress.total}};
  }

  if (busy === 'clean' && cleanProgress) {
    return {text: cleanProgress.targetPath, tone: 'cyan', progress: {current: cleanProgress.current, total: cleanProgress.total}};
  }

  if (confirming) {
    return {text: 'confirm cleanup', tone: 'yellow'};
  }

  if (executionResult) {
    return {text: `reclaimed ${formatBytes(executionResult.bytesReclaimed)}`, tone: 'green'};
  }

  if (scanResult) {
    return {text: `${scanResult.candidates.length} targets in ${formatDuration(scanResult.durationMs)}`, tone: 'green'};
  }

  return {text: 'ready', tone: 'gray'};
}

function sectionLabel(section: SectionId): string {
  switch (section) {
    case 'scope':
      return 'Scope';
    case 'preset':
      return 'Mode';
    case 'categories':
      return 'Categories';
    case 'targets':
      return 'Review';
    case 'actions':
      return 'Actions';
  }
}

function resolveSection(requested: SectionId, availableSections: SectionId[]): SectionId {
  if (availableSections.includes(requested)) {
    return requested;
  }

  return 'actions';
}

function nextSection(current: SectionId, availableSections: SectionId[], direction: 1 | -1): SectionId {
  const currentIndex = Math.max(0, availableSections.indexOf(current));
  const nextIndex = (currentIndex + direction + availableSections.length) % availableSections.length;
  return availableSections[nextIndex] ?? current;
}

interface ListWindow {
  start: number;
  end: number;
  size: number;
}

function getWindow(total: number, cursor: number, size: number): ListWindow {
  const safeSize = Math.max(1, size);
  if (total <= safeSize) {
    return {start: 0, end: total, size: safeSize};
  }

  const pageStart = Math.floor(cursor / safeSize) * safeSize;
  return {start: pageStart, end: Math.min(total, pageStart + safeSize), size: safeSize};
}

function getTerminalModel(width: number, height: number) {
  const safeWidth = Math.max(24, width || 80);
  const safeHeight = Math.max(8, height || 24);
  const compact = safeWidth < 72 || safeHeight < 20;
  const paddingX = safeWidth > 38 ? 1 : 0;
  const reservedRows = compact ? 7 : 11;

  return {
    width: safeWidth,
    height: safeHeight,
    compact,
    paddingX,
    contentWidth: Math.max(20, safeWidth - paddingX * 2 - (compact ? 0 : 4)),
    bodyRows: Math.max(1, safeHeight - reservedRows)
  };
}

function truncate(value: string, maxLength: number): string {
  const safeMax = Math.max(0, maxLength);
  if (value.length <= safeMax) {
    return value;
  }

  if (safeMax <= 3) {
    return value.slice(0, safeMax);
  }

  return `${value.slice(0, safeMax - 3)}...`;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
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
