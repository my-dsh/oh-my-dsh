# Agent Note: Clean the local feature surface after the alpha.5 merge

Status: implemented

English | [中文](2026-09-02-local-feature-surface-cleanup.zh.md)

## Problem

The fork's local feature commits (token-usage dashboard, step-timing/zoned-time utilities, session-attention) landed before upstream's `dsh-v0.1.2-alpha.5` merge and drifted from four repository gates:

- Five packages published empty `./invariant` companions (`dsh-token-usage`, `dsh-client-token-usage`, `dsh-token-usage-dashboard`, `dsh-step-timing`, `dsh-zoned-time`), each carrying a source file, public subpath, publication entry, invariant-only dependency edges, and TypeScript references — the exact shape [omit-unneeded-invariant-companions](2026-08-28-omit-unneeded-invariant-companions.md) rejected for the other 209 packages.
- `dsh-token-usage` committed compiled `types.js`/`types.d.ts`/`.js.map` residue beside `src/types.ts`.
- Four directories of build output for packages upstream deleted (`code-runtime-python`, `agent-spine-demo`, `session-persistence-sqlite`, `tool-subagent-report`) survived on disk, so `verify-tool-catalog`'s `packages/*/tool-*` glob found a nonexistent package.
- `CLAUDE.md`, `packages/CLAUDE.md` (git symlinks), and `apps/cli/tests/profiles/acp/cordis.yml` had been checked out as plain-text files containing the target path, failing `verify-cordis-config` at the ACP profile.
- The dashboard violated three style/i18n contracts: full-round radii without `corner-shape: round` (3 rules + ChatView's turn-status dot), 1px neutral borders instead of 0.5px hairlines (7 rules), and 33 hardcoded English fallback strings beside a bound translator.
- `packages/api/remotes`, `dsh-client-token-usage`, and `dsh-client-connection` declared browser/type-only edges in `peerDependencies`, against the client dependency policy.
- The five local packages kept version `0.1.2-alpha.1` while the merged tree is `0.1.2-alpha.5`.

## Decision

Apply the recorded upstream rules to the local surface rather than exempting it:

- Omit the five empty companions per the invariant rule: delete `src/invariant.ts`, the `./invariant` export, `lib/invariant.js` publication, `@deepseek-ai/dsh-invariants` dependency edges, tsconfig references, and tsdown entries; state the package-specific omission reason in both READMEs next to Model Experience (outside the gate's fixed sentence/KV-paragraph structure).
- Delete the compiled `src/types.*` residue; `src/types.ts` is the only source and the `./types` export resolves `lib/types/types.js` (built).
- `pnpm run clean` removes deleted-package residue; re-generate `tsconfig.base.json` aliases, doc graphs (both languages), and the module graph so generated files match the merged tree.
- Restore damaged symlinks (`CLAUDE.md`, `packages/CLAUDE.md`, the ACP profile cordis.yml) to their git-recorded link form.
- Fix the style/i18n contracts in place: pair `corner-shape: round` on full-round radii, drop neutral borders to 0.5px hairlines, and collapse `t?.('key') ?? 'Fallback'` into required `t('key')` calls — `TokenUsageDashboardProps` becomes the full inject face (the inject closure always binds `t` and `api`, so the optional guards were dead).
- `verify-package-dependencies --fix` moves browser/type edges to devDependencies; local package versions bump to `0.1.2-alpha.5`.

## Verification

`verify-package-invariants` (39 companions conform), `verify-cordis-config` (133 files), `verify-client-ui-i18n` (486 files), `verify-package-dependencies` (53 packages), `rescope-vendor:check`, `doc-sync` (32 gates), `hygiene` (15 gates), `typecheck`, `test:gui` (3919 tests), the touched packages' unit tests (187 tests), and the full `pnpm run build` all pass. Pre-existing, unrelated failures stay: process-bound suites fail in this environment, and `test:web` persisted-replay drift reproduces identically at the pre-merge commit.

## Alternatives considered

- **Keep the empty companions with explanatory comments.** Rejected because the omit-invariant-companions decision already ruled that shape invalid for the other 209 packages; the fork's packages get no exemption.
- **Keep the translator fallbacks for safety.** Rejected because `ctx.locale.bind` always supplies `t` before the slot registers, so the `?? 'Fallback'` arms were unreachable and the i18n gate's rule (locale-owned copy only) exists to keep exactly this drift out.
- **Re-record the persisted web-replay snapshots in this change.** Rejected because the drift reproduces at the pre-merge commit — it predates this cleanup and belongs to the feature branch's own snapshot work, not to the merge-follow-up.

## Consequences

The five packages now carry no invariant wiring at all — adding one requires revisiting the omission reason in both READMEs and shipping a companion that checks a real relationship, per the owning decision. The dashboard's copy is exclusively locale-dictionary-owned, so a missing key fails the type check instead of falling back silently. Generated artifacts (tsconfig aliases, doc graphs, module graph) track the merged tree again, and future merges of upstream deletions should run `pnpm run clean` before the tool-catalog gate.

## What we give up

Nothing: the removed companions installed zero checks, the fallback strings were unreachable behind an always-bound translator, and the residue files had no importer.
