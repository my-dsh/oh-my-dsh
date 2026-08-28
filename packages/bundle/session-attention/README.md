---
description: "The session attention overlay as a profile bundle: a character dance animation in shell.overlay while any session awaits the user's action or a background reply finished unopened."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-session-attention`

English | [中文](README.zh.md)

## Summary

The session attention overlay as a profile bundle: one install inserts the browser-only panel that registers into `shell.overlay`. The panel peeks a character in from the top-right edge and plays a kind-specific dance while any session awaits the user's action (approval / plan review / question) or a background session's reply finished unopened, then retreats when all sessions are handled. A profile that already mounts `@deepseek-ai/dsh-web-app` must not install this bundle — the entry would register twice and fail the load.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-session-attention
dsh plugin --profile <name> remove @deepseek-ai/dsh-session-attention
```

The row resolves from the in-box package set; the reconcile step activates the browser panel on the next `dsh web` boot. The panel renders only inside a web surface, so the target profile must already provide the client runtime, connection, and `shell.overlay` layout. Requires `pnpm` on `PATH`.

### What you get

One `shell.overlay` entry (`@deepseek-ai/dsh-client-ui-session-attention`) — a character dance animation panel that surfaces sessions awaiting action and completed-reply reminders.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch document ([`cordis.patch.yml`](cordis.patch.yml)) inserts one row:

| Row id | Package | Role |
|---|---|---|
| `ui-session-attention` | `@deepseek-ai/dsh-client-ui-session-attention` | Browser panel registering into `shell.overlay` |

The panel has no host half, no Service Definition, and no events; it reads the standard `useSessions` and `useSessionPendingInteraction` feeds already provided by the web surface. The bundle's substance is the patch list and it carries no runtime API.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel is a pure browser UI consuming the session-list and pending-interaction feeds.

#### KV Cache effect

None; the client panel assembles no provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A web surface is required** — the browser panel registers into `shell.overlay` (owned by `@deepseek-ai/dsh-client-ui-layout`) and reads the `useSessions` and `useSessionPendingInteraction` standard hooks, so this bundle composes over a web-surface profile and not a host-only or headless one.
- **Mutually exclusive with `@deepseek-ai/dsh-web-app`** — that bundle previously included the same row, so installing both registers the `shell.overlay` entry twice and fails the load.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The overlay reads pending interactions from the `useSessionPendingInteraction` standard hook, not from `SessionListState.byId` — `projectList()` never populates a `pendingInteraction` field on the host `SessionSummary`. See the [pendingInteraction data flow fix](../../../.agents/notes/implemented/bug-fix/2026-08-28-session-attention-pending-interaction-fix.md).

</details>
