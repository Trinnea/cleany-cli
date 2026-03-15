import {Command, InvalidArgumentError} from 'commander';
import {runHeadless} from './core/headless.js';
import {assertSupportedPlatform, getRuntimeDefaults} from './core/registry.js';
import {PRESET_VALUES, SCOPE_VALUES, type CliOptions, type Preset, type Scope} from './types.js';

function parseScope(value: string): Scope {
  if (SCOPE_VALUES.includes(value as Scope)) {
    return value as Scope;
  }

  throw new InvalidArgumentError(`Invalid scope: ${value}`);
}

function parsePreset(value: string): Preset {
  if (PRESET_VALUES.includes(value as Preset)) {
    return value as Preset;
  }

  throw new InvalidArgumentError(`Invalid mode: ${value}`);
}

function applySharedOptions(command: Command): Command {
  return command
    .option('--scope <scope>', 'scan scope: local or global', parseScope)
    .option('--mode <mode>', 'cleanup mode: full, node-modules, build, caches, aggressive', parsePreset)
    .option('--path <dir>', 'local root path override')
    .option('--dry-run', 'preview the cleanup without deleting anything')
    .option('--yes', 'skip the final confirmation in headless cleanup')
    .option('--no-trash', 'permanently delete all selected targets')
    .option('--json', 'emit JSON output and skip the TUI');
}

function toCliOptions(intent: CliOptions['intent'], input: Record<string, unknown>, command?: Command): CliOptions {
  const resolved = command ? (command.optsWithGlobals() as Record<string, unknown>) : input;
  return {
    intent,
    scope: resolved.scope as Scope | undefined,
    mode: resolved.mode as Preset | undefined,
    path: resolved.path as string | undefined,
    dryRun: Boolean(resolved.dryRun),
    yes: Boolean(resolved.yes),
    noTrash: Boolean(resolved.noTrash),
    json: Boolean(resolved.json)
  };
}

export async function runCli(argv = process.argv): Promise<void> {
  const runtime = getRuntimeDefaults();
  assertSupportedPlatform(runtime.platform);

  const program = new Command();
  program.name('cleany').description('A macOS CLI for cleaning developer storage.');
  applySharedOptions(program).action(async (input, command) => {
    await runIntent(toCliOptions('default', input, command), runtime);
  });

  applySharedOptions(program.command('scan').description('Scan for reclaimable storage without cleaning.')).action(async (input, command) => {
    await runIntent(toCliOptions('scan', input, command), runtime);
  });

  applySharedOptions(program.command('clean').description('Scan and clean selected targets.')).action(async (input, command) => {
    await runIntent(toCliOptions('clean', input, command), runtime);
  });

  await program.parseAsync(argv);
}

async function runIntent(options: CliOptions, runtime: ReturnType<typeof getRuntimeDefaults>): Promise<void> {
  if (runtime.isInteractive && !options.json) {
    const [{default: React}, {render}, {CleanyApp}] = await Promise.all([
      import('react'),
      import('ink'),
      import('./tui/app.js')
    ]);
    const app = render(React.createElement(CleanyApp, {options, runtime}));
    await app.waitUntilExit();
    return;
  }

  const result = await runHeadless(options, runtime);
  if (result.output) {
    process.stdout.write(`${result.output}\n`);
  }
  process.exitCode = result.exitCode;
}

runCli().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
