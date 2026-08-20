# Agent Note: tsdown preset resolves the repository root from `process.cwd()`

Status: implemented

English | [中文](2026-08-20-tsdown-preset-root-from-process-cwd.zh.md)

## Problem

The shared `packages/client/tsdown.client.ts` preset locates workspace manifests via a repository-root constant. The original definition used `fileURLToPath(new URL('../..', import.meta.url))`, which resolves correctly only when `import.meta.url` points at the preset file's own location (`packages/client/tsdown.client.ts`, two levels below the repository root).

`tsdown@0.22.2` introduced `unrun` as the default config loader (`auto` resolves to `unrun` when native TypeScript is unavailable). `unrun` bundles the consumer config and inlines the preset, then rewrites `import.meta.url` to the consumer config file's URL — not the preset's. For a consumer at `packages/api/remotes/tsdown.config.ts` the rewrite yields `new URL('../..', '.../packages/api/remotes/tsdown.config.ts')`, which resolves to `packages/` instead of the repository root; for `packages/client/ui-theme/tsdown.config.ts` it resolves to `packages/client/`. `globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })` then matches nothing, and every `workspaceManifest(id)` lookup throws `tsdown: no packages/*/*/package.json declares the name <id>`. The first lookup happens to be `@deepseek-ai/dsh-api-remotes`, so the build fails there even though the preset is the real defect.

## Decision

The preset derives `REPOSITORY_ROOT` from `process.cwd()`. tsdown evaluates every workspace package config with the repository root as `process.cwd()` — the `workspaceManifest` JSDoc already documents this invariant, and `scripts/build.ts` runs every build script from the repository root. The build's cwd is therefore the correct, stable source of the repository root, independent of which config loader tsdown uses.

## Alternatives considered

**Resolve the preset file's location from the call stack.** A `new Error().stack` walk is fragile across V8 versions, adds work to every build, and duplicates what `process.cwd()` already guarantees.

**Pin `--config-loader tsx` on every tsdown invocation.** This avoids `unrun`'s `import.meta.url` rewrite but forces a slower loader across the whole build and locks out the loader tsdown ships as its default. The defect is the preset's reliance on a value the config loader rewrites, not the loader choice.

**Compute the root relative to a known workspace package.** Resolving `packages/<group>/<pkg>` from the consuming config's directory would re-introduce the same `import.meta.url`-style fragility and hardcode the `packages/*/*` layout into the preset.

## Consequences

The preset no longer depends on `import.meta.url`, so any tsdown config loader that preserves `process.cwd()` (native, tsx, unrun) produces the same repository root. The preset's correctness now rests on the build always running from the repository root, which `scripts/build.ts` and tsdown's workspace evaluation both guarantee and which the `workspaceManifest` JSDoc already records. Other `import.meta.url` uses in the preset (`browserSourcePath`) compute only relative paths from a sourcemap and are unaffected.
