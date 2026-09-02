# Agent Note: Session-attention overlay renders a Canvas2D 3D panel while the user owes action

Status: implemented

English | [中文](2026-08-22-session-attention-overlay.zh.md)

## Problem

A backgrounded session that finishes an AI reply, or one paused on an approval / plan-review / question, gives the user no in-page signal until they re-open the sidebar. The dynamic prototype (`notify-1`) proved the shape — a `shell.overlay` entry watching `useSessions` that shows a 3D animation while attention is owed — but a published plugin could not ship it: the prototype loaded three.js from a runtime CDN `<script>`, a network dependency unsuited to an installable package, and the WebGL render path could not reach the per-file 100% coverage gate (jsdom has no WebGL context).

## Decision

**The published package `@deepseek-ai/dsh-client-ui-session-attention` draws the 3D effect on a Canvas2D context with hand-written projection, not three.js.** Points live on a sphere, rotate in 3D, and project to 2D through perspective (`scene.ts`); the frame computation (`computeScene`) is a pure function over time that dispatches on the attention kind, and `paintFrame` is the only canvas touch. The projection math, depth sort, depth falloff, and each kind's geometry are unit-tested without a canvas, so the package reaches 100% coverage in jsdom with no network or WebGL dependency.

**Every drawable blits one pre-rendered glow sprite additively, and `paintFrame` clears the full device-pixel bitmap.** Clearing only the CSS-sized region while the bitmap is scaled by `devicePixelRatio` would let stale pixels accumulate into a solid blob on any display above unity DPR, so the clear uses the same ratio as the bitmap. The numeric scene constants are aesthetic choices tuned against live in-browser prototypes, not derived values.

**One of four distinct scenes plays, keyed by the highest-priority attention kind present, so the user can tell at a glance what kind of reminder is owed.** `approval` is a swirling lens galaxy — a rotating glowing particle shell around a breathing core, circled by a tilted orbit ring carrying a bright comet with a fading trail; `plan-review` is a radar sweep — two concentric dashed rings and a rotating radial arm with blips; `question` is an echo — a breathing core with ripple rings pulsing outward and fading; `completed` is a calm pulse — a large breathing halo with a slow orbiting set of dots. The scene's accent color follows the same highest-priority kind, so animation and color stay consistent.

**The overlay is persistent, not a badge.** The entry renders the whole time attention is owed, rather than collapsing to a dot the user must click back open; the user sees the animation and the waiting rows directly. Each row carries its session's status color and a localized kind label, clicking a row opens that session, and the browser tab title is prefixed `(N)` so the reminder survives a backgrounded tab. The overlay clears entirely once every waiting session is handled and every background reply opened.

**Attention selection mirrors the sidebar status dots.** `selectAttention` derives rows from `useSessions` — the same feed the sidebar dots use. A `pendingInteraction` (`approval` / `plan-review` / `question`) is the amber waiting dot; a `completed` background session (finished while not selected and not yet opened) is the green done reminder. The current session never surfaces as completed; a pending interaction outranks completion for the same session. Rows sort by kind priority then session id, capped at five with a "+N more" tail. The accent color follows the highest-priority kind present; a panel of only completions uses the green theme.

**No host half and no locale namespace.** The host half is an empty apply; the plugin is pure presentation and owns no host-side behavior. Copy rides injected defaults (Chinese) rather than the standard locale seat, so a locale switch does not re-translate the panel — wiring `dsh-client-locale` is a deferred localization follow-up.

## Alternatives considered

**A three.js WebGL scene loaded from a CDN `<script>`, as the dynamic prototype did.** Rejected for a published package: the runtime CDN load is a network dependency, and a WebGL render path is unreachable under the per-file 100% coverage gate because jsdom has no WebGL context. Canvas2D keeps the effect dependency-free and fully testable while remaining a genuine 3D projection.

**Auto-hide to a corner badge that the user clicks to re-expand.** Rejected: the requirement is to see the animation directly while attention is owed, not to collapse it behind an interaction.

## Consequences

A user with a backgrounded tab sees the reminder in the tab title and, on returning, sees the persistent 3D panel and each waiting session by name and color until they act on every one. The panel ships from the standalone [`dsh-session-attention` repository](https://github.com/my-dsh/dsh-session-attention) as the bundle `@deepseek-ai/dsh-session-attention` (one `cordis.patch.yml` row), installable over any web-surface profile; the in-tree duplicate packages were removed and the profile installation is the only source.

## Testing

`attention.client.spec.ts`, `scene.client.spec.ts`, `panel.client.spec.tsx`, and `apply.client.spec.tsx` covered the pure selection, the projection math, the rendered panel, and the `shell.overlay` registration while the package lived in this tree; they moved with the extraction to the standalone repository, which owns the overlay's continued testing. The `apps/web/tests/session-attention.snapshot.ts` assembled-boot test was removed with the in-tree packages: the assembled lane composes only the base and web-app bundles, so after the extraction it could no longer mount the overlay.

## Related

- [Slot system standard](../architecture/2026-07-22-slot-type-chain-implementation.md) — the `ctx.slots.inject` deferred registration the overlay entry uses.
- [Package invariant runtime contracts](../architecture/2026-07-19-package-invariant-runtime-contracts.md) — the empty-invariant companion pattern the package follows.
- [Fix pendingInteraction data flow and standalone bundle](../bug-fix/2026-08-28-session-attention-pending-interaction-fix.md) — the data source fix and bundle extraction.
