# Agent Note: Session-attention overlay renders a Canvas2D 3D panel while the user owes action

Status: implemented

English | [中文](2026-08-22-session-attention-overlay.zh.md)

## Problem

A backgrounded session that finishes an AI reply, or one paused on an approval / plan-review / question, gives the user no in-page signal until they re-open the sidebar. The dynamic prototype (`notify-1`) proved the shape — a `shell.overlay` entry watching `useSessions` that shows a 3D animation while attention is owed — but a published plugin could not ship it: the prototype loaded three.js from a runtime CDN `<script>`, a network dependency unsuited to an installable package, and the WebGL render path could not reach the per-file 100% coverage gate (jsdom has no WebGL context).

## Decision

**The published package `@deepseek-ai/dsh-client-ui-session-attention` draws the 3D effect on a Canvas2D context with hand-written projection, not three.js.** Points live on a sphere, rotate in 3D, and project to 2D through perspective (`scene.ts`); the frame computation (`computeFrame`) is a pure function over the point set and time, and `paintFrame` is the only canvas touch. The projection math, depth sort, and depth falloff are unit-tested without a canvas, so the package reaches 100% coverage in jsdom with no network or WebGL dependency.

**Every drawable blits one pre-rendered glow sprite additively, and `paintFrame` clears the full device-pixel bitmap.** The scene renders a small planet system — a rotating glowing particle shell around a breathing center halo, circled by a tilted orbit ring carrying a comet with a fading trail, each particle twinkling on its own phase — so overlapping particles accumulate luminosity rather than opacity. Clearing only the CSS-sized region while the bitmap is scaled by `devicePixelRatio` would let stale pixels accumulate into a solid blob on any display above unity DPR, so the clear uses the same ratio as the bitmap. The numeric scene constants are aesthetic choices tuned against live in-browser prototypes, not derived values.

**The overlay is persistent, not a badge.** The entry renders the whole time attention is owed, rather than collapsing to a dot the user must click back open; the user sees the animation and the waiting rows directly. Each row carries its session's status color and a localized kind label, clicking a row opens that session, and the browser tab title is prefixed `(N)` so the reminder survives a backgrounded tab. The overlay clears entirely once every waiting session is handled and every background reply opened.

**Attention selection mirrors the sidebar status dots.** `selectAttention` derives rows from `useSessions` — the same feed the sidebar dots use. A `pendingInteraction` (`approval` / `plan-review` / `question`) is the amber waiting dot; a `completed` background session (finished while not selected and not yet opened) is the green done reminder. The current session never surfaces as completed; a pending interaction outranks completion for the same session. Rows sort by kind priority then session id, capped at five with a "+N more" tail. The accent color follows the highest-priority kind present; a panel of only completions uses the green theme.

**No host half and no locale namespace.** The host half is an empty apply; the plugin is pure presentation and owns no host-side behavior. Copy rides injected defaults (Chinese) rather than the standard locale seat, so a locale switch does not re-translate the panel — wiring `dsh-client-locale` is a deferred localization follow-up.

## Alternatives considered

**A three.js WebGL scene loaded from a CDN `<script>`, as the dynamic prototype did.** Rejected for a published package: the runtime CDN load is a network dependency, and a WebGL render path is unreachable under the per-file 100% coverage gate because jsdom has no WebGL context. Canvas2D keeps the effect dependency-free and fully testable while remaining a genuine 3D projection.

**Auto-hide to a corner badge that the user clicks to re-expand.** Rejected: the requirement is to see the animation directly while attention is owed, not to collapse it behind an interaction.

## Consequences

A user with a backgrounded tab sees the reminder in the tab title and, on returning, sees the persistent 3D panel and each waiting session by name and color until they act on every one. The package adds one row to `packages/bundle/web-app/cordis.patch.yml` and the web-app manifest, and the assembled-boot snapshot pins its registration and the fixture's pending-question row.

## Testing

`attention.client.spec.ts` covers the pure selection, key, and completion logic; `scene.client.spec.ts` covers the projection math, the sprite-blit `paintFrame`, and the `createAttentionScene` lifecycle (one-frame loop, reduced-motion static frame, no-raf disposal, null-context no-op). `panel.client.spec.tsx` renders `AttentionPanel` against a fake `useSessions` with an injectable scene factory and covers empty render, every attention kind, the completed theme, click-to-open, title tagging and restore, the +N tail, reduced motion, the default copy path, and a throwing scene factory. `apply.client.spec.tsx` covers the `shell.overlay` registration, deferred injection, the open-session action, and teardown. `apps/web/tests/session-attention.snapshot.ts` boots the assembled built graph against the keyless fixture transport and pins the overlay's wrap presence, head count, the fixture pending-question row, and the tagged tab title.

## Related

- [Slot system standard](../architecture/2026-07-22-slot-type-chain-implementation.md) — the `ctx.slots.inject` deferred registration the overlay entry uses.
- [Package invariant runtime contracts](../architecture/2026-07-19-package-invariant-runtime-contracts.md) — the empty-invariant companion pattern the package follows.
