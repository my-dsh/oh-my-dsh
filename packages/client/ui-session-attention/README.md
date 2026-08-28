---
description: "Web GUI session-attention overlay plugin: a character dance animation in shell.overlay while any session awaits the user's action or a background reply finished unopened."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-attention

English | [中文](README.zh.md)

## Summary

Web GUI session-attention overlay plugin: its browser half contributes one entry to the root-scoped `shell.overlay` list slot (owned and declared by `dsh-client-ui-layout`). The entry watches the standard `useSessions` and `useSessionPendingInteraction` feeds and renders a character that peeks in from the top-right edge, jumps out to play a kind-specific dance when any session awaits the user's action (approval / plan review / question) or a background session's AI reply finished without being opened since, then retreats when all sessions are handled. Its host half is empty on purpose; the plugin is pure presentation and owns no host-side behavior.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

The character lifecycle is a four-phase state machine: `peek → enter → dance → exit → peek`. In the `peek` phase only a small slice of the character is visible in the top-right corner (clipped by an overflow-hidden container), barely occupying the interface. When attention arrives the character transitions to `enter` (slides up with an elastic overshoot), then to `dance` where it plays one of four kind-specific animations, then to `exit` when all sessions are handled, and finally back to `peek`. While attention is owed the browser tab title is prefixed with `(N)` so the reminder survives a backgrounded tab.

The character can be a user-supplied PNG (configured through the plugin's `characterImage` config key as a URL or data-URI) or, when no image is provided, a procedurally drawn fallback creature — a round-bodied character with eyes, a smile, blush, and stubby limbs. The animation engine applies per-frame `translate / rotate / scale / squash` transforms purely from elapsed time and lifecycle phase, kept deterministic (no `Math.random` in the frame path) and fully testable in jsdom. Four dances map to the four attention kinds: `approval` is an urgent fidget with quick hops and body shake; `plan-review` is a thinking sway with head tilt and sparkles during the "thinking" window; `question` is a confused wiggle with alternating head tilts and a "?" bubble; `completed` is a celebration with bounce-jumps, sway, spin, and sparkles. The character scene's RAF loop pauses when the tab is backgrounded and resumes from the same elapsed time when the tab returns.

Each attention row carries its session's status color and localized kind label, and clicking a row opens that session in the sidebar so the user can act on it. Rows sort by kind priority (waiting first) then by session id, and at most five rows render before a "+N more" tail.

<a id="configuration"></a>
## Configuration

The `characterImage` plugin config key accepts a URL or data-URI for a custom character PNG. When unset, the procedural fallback creature is used. Example `cordis.yml`:

```yaml
- id: ui-session-attention
  name: '@deepseek-ai/dsh-client-ui-session-attention'
  config:
    characterImage: 'data:image/png;base64,...'
```

<a id="model-experience"></a>
## Model Experience

None, as the overlay renders the existing browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The character PNG load path is browser-only** — jsdom's `Image` never fires `onload`/`onerror`, so the PNG blit path is only exercised in a real browser; jsdom tests always render the procedural fallback.
- **No locale namespace** — copy rides injected defaults (Chinese) rather than the standard locale seat, so a locale switch does not re-translate the panel. Wiring `dsh-client-locale` is a localized follow-up if the panel needs translation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The overlay reads pending interactions from the `useSessionPendingInteraction` standard hook, not from `SessionListState.byId.pendingInteraction` — `projectList()` never populates that field. See the [pendingInteraction data flow fix](../../../.agents/notes/implemented/bug-fix/2026-08-28-session-attention-pending-interaction-fix.md).

</details>
