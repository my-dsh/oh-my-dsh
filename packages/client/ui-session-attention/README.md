# @deepseek-ai/dsh-client-ui-session-attention

English | [中文](README.zh.md)

Web GUI session-attention overlay plugin: its browser half contributes one entry to the root-scoped `shell.overlay` list slot (owned and declared by `dsh-client-ui-layout`). The entry watches the standard `useSessions` feed — the same data the sidebar status dots use — and renders a persistent 3D animation panel while any session awaits the user's action: a pending interaction (approval / plan review / question) or an AI reply that finished without being opened since. Its host half is empty on purpose; the plugin is pure presentation and owns no host-side behavior.

The panel stays visible the whole time attention is owed, rather than collapsing to a badge that the user must click back open; it is fixed in the top-right corner of the browser viewport, overlaying the page on top. Each attention row carries its session's status color and localized kind label, and clicking a row opens that session in the sidebar so the user can act on it. While attention is owed the browser tab title is prefixed with `(N)` so the reminder survives a backgrounded tab. The overlay clears entirely once every waiting session is handled and every finished reply has been opened. The 3D animation pauses its frame loop when the tab is backgrounded and resumes from the same elapsed time when the tab returns.

The 3D animation is a small planet system drawn on a Canvas2D context with hand-written perspective projection and depth sorting: a shell of glowing particles rotates in 3D around a breathing center halo, circled by a tilted orbit ring carrying one bright comet with a fading trail, and each particle twinkles on its own phase. It is a genuine 3D effect (points live on a sphere, rotate in 3D, and project to 2D with perspective) kept dependency-free and fully testable in jsdom — the projection math is pure, and the canvas draw is driven by that pure frame computation. Every drawable blits the same pre-rendered radial-gradient glow sprite additively (`lighter`), so overlapping particles gain luminosity instead of opacity, and each frame clears the full device-pixel bitmap so displays with `devicePixelRatio > 1` never accumulate residue between frames. The package deliberately does not depend on the three.js library: a WebGL render path is unreachable under the per-file 100% coverage gate (jsdom has no WebGL context), and the runtime CDN `<script>` load used by the dynamic prototype is a network dependency unsuited to a published plugin. The accent color follows the highest-priority attention kind present: amber (approval), violet (plan review), cyan (question), or green (reply completed); a panel whose every row is a background completion uses the green theme.

Attention kinds mirror the sidebar status dots exactly: a `pendingInteraction` (`approval` / `plan-review` / `question`) is the amber "waiting for the user" dot, and a `completed` session (finished running and not opened since) is the green "done" reminder dot — including the currently-open session, whose row click re-selects it and consumes the reminder. A pending interaction outranks completion for the same session. Rows sort by kind priority (waiting first) then by session id, and at most five rows render before a "+N more" tail.

## Model Experience

None, as the overlay renders the existing browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The animation is Canvas2D, not the three.js library** — a WebGL/Three.js render path is unreachable under the per-file 100% coverage gate because jsdom has no WebGL context, so the package ships the hand-written 3D projection instead. It is a genuine 3D effect but visually simpler than a shaded three.js scene.
- **No locale namespace** — copy rides injected defaults (Chinese) rather than the standard locale seat, so a locale switch does not re-translate the panel. Wiring `dsh-client-locale` is a localized follow-up if the panel needs translation.
