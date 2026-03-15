# Cleany

Cleany is a macOS-first CLI for reclaiming disk space from disposable developer artifacts like `node_modules`, framework build output, caches, logs, and Xcode `DerivedData`.

It is built for people who bounce between multiple local projects and want a fast way to see what can be deleted before removing anything.

## What It Does

- Scans local projects or common developer folders on macOS
- Finds reclaimable storage across JavaScript and Apple development workflows
- Builds a cleanup plan before deletion
- Uses Trash where possible for safer cleanup
- Supports interactive terminal usage and JSON output for scripts

## What Cleany Can Clean

### Local project artifacts

- `node_modules`
- `.next`
- `.nuxt`
- `.svelte-kit`
- `.turbo`
- `.parcel-cache`
- `dist`
- `build`
- `coverage`
- `.cache`
- `.vite`
- `.eslintcache`
- `.tmp` and `.temp`
- `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `pnpm-debug.log*`

### Global aggressive cleanup targets

- npm cache
- pnpm store and cache
- Yarn cache
- Bun cache
- `~/Library/Caches/*`
- `~/Library/Logs/*`
- `~/Library/Developer/Xcode/DerivedData/*`

## Safety Model

- macOS only
- Interactive by default when running in a TTY
- `--dry-run` previews cleanup without deleting anything
- Headless cleanup requires `--yes`
- Trash-first deletion is used when supported
- `--no-trash` forces permanent deletion

## Install

Cleany is not documented here as a published npm package yet, so the current workflow is to run it from source.

```bash
npm install
npm run build
npm link
```

After `npm link`, the `cleany` command is available globally on your machine.

## Usage

```bash
cleany [options]
cleany scan [options]
cleany clean [options]
```

### Options

```text
--scope <scope>  scan scope: local or global
--mode <mode>    cleanup mode: full, node-modules, build, caches, aggressive
--path <dir>     local root path override
--dry-run        preview the cleanup without deleting anything
--yes            skip the final confirmation in headless cleanup
--no-trash       permanently delete all selected targets
--json           emit JSON output and skip the TUI
```

### Examples

Scan the current directory in interactive mode:

```bash
cleany scan
```

Preview cleanup for a specific project without deleting anything:

```bash
cleany clean --path ~/Code/my-app --dry-run
```

Only look for `node_modules` folders:

```bash
cleany scan --mode node-modules --path ~/Code
```

Run an aggressive global scan and emit JSON:

```bash
cleany scan --scope global --mode aggressive --json
```

Run non-interactive cleanup from a script:

```bash
cleany clean --scope global --mode aggressive --json --yes
```

Run from source during development:

```bash
npm run dev -- scan --path ~/Code/my-app
```

## Modes

- `full`: `node_modules`, build artifacts, project caches, and temp logs
- `node-modules`: dependency folders only
- `build`: framework and compiler output only
- `caches`: project caches and temp logs
- `aggressive`: full cleanup plus package manager caches, macOS user caches/logs, and Xcode `DerivedData`

## Scopes

- `local`: scans the current directory or the path passed with `--path`
- `global`: scans common macOS developer roots such as `~/Documents`, `~/Desktop`, `~/Developer`, `~/Code`, `~/Projects`, and similar workspace folders, plus supported system cache locations for aggressive cleanup

## Output Modes

- Interactive TUI: used automatically in a terminal when `--json` is not set
- Headless text output: used in non-interactive runs
- JSON output: use `--json` for scripts, automation, or machine-readable results

In headless cleanup mode, Cleany refuses to delete anything unless `--yes` is provided.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

## Open Source

Cleany is intended to be a fully open source tool. A permissive license is the right fit if you want broad use, easy contributions, and minimal friction for individuals and companies adopting it.

This repository currently uses the MIT license.
