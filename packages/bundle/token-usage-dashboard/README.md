---
description: "The Token consumption dashboard as a profile bundle: inserts the host-side capture and SQLite provider plus the browser dashboard panel over any web-surface profile."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-token-usage-dashboard`

English | [中文](README.zh.md)

## Summary

The Token consumption dashboard as a profile bundle: one install gives both ends of the feature — the host-side capture (SQLite provider + session listener) and the browser dashboard panel. `@deepseek-ai/dsh-web-app` already includes these same three rows, so this bundle exists to add the full dashboard to a web-surface profile that does not mount it. A profile that already mounts `@deepseek-ai/dsh-web-app` must not install this bundle.

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
dsh plugin --profile <name> add @deepseek-ai/dsh-token-usage-dashboard
dsh plugin --profile <name> remove @deepseek-ai/dsh-token-usage-dashboard
```

The browser panel renders only inside a web surface, so the target profile must already provide the client runtime, connection, and `shell.overlay` layout. It composes over a web-surface profile and mounts on a `dsh web` boot. Requires `pnpm` on `PATH` and a `dsh` installation that provides the in-box dependencies the rows name.

### What you get

Three rows: the SQLite provider behind `tokenUsageStore`, the session/event listener that appends per-request usage records, and the floating-button dashboard panel registered into `shell.overlay`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch document ([`cordis.patch.yml`](cordis.patch.yml)) inserts four rows:

| Row id | Package | Role |
|---|---|---|
| `token-usage-sqlite` | `@deepseek-ai/dsh-token-usage/sqlite-provider` | SQLite provider for `tokenUsageStore` |
| `token-usage` | `@deepseek-ai/dsh-token-usage` | Session/event listener appending usage records |
| `token-usage-remote` | `@deepseek-ai/dsh-token-usage/service` | Typert Remote service exposing daily summaries |
| `ui-token-usage` | `@deepseek-ai/dsh-client-token-usage` | Browser dashboard panel in `shell.overlay` |

The listener injects `tokenUsageStore`, so it activates only after the provider mounts. The bundle's substance is the patch list and it carries no runtime API.

</details>

No invariant companion is published because the bundle's module carries no runtime API — its substance is `cordis.patch.yml`, and the inserted packages own their behavior and its checks.

-----

<a id="model-experience"></a>
## Model Experience

None, as the inserted listener only observes the session stream and persists provider-reported accounting.

#### KV Cache effect

None; neither inserted host row nor the client panel assembles a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A web surface is required** — the browser panel registers into `shell.overlay` (owned by `@deepseek-ai/dsh-client-ui-layout`) and reads the `tokenUsage` wire domain, so this bundle composes over a web-surface profile and not a host-only or headless one.
- **Mutually exclusive with `@deepseek-ai/dsh-web-app`** — that bundle already includes the same three rows, so installing both registers the `tokenUsageStore` service twice and fails the load.
- **Local timezone day bucketing** — the aggregate groups records by calendar day in the host's local timezone, matching the panel's day picker, rather than UTC. A locale-configured bucketing mode is deferred until a deployment states a requirement.
- **No retention policy** — the store never auto-expires data; growth is bounded by `purge()` calls.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Capture starts on the next boot and needs no configuration: every successful model call appends one record, and the bundled browser panel shows the daily `(provider, model)`-grouped totals from the wire `tokenUsage` domain. The store never auto-deletes; `tokenUsage.purge(before?)` drops rows before an epoch-millisecond cutoff for retention.

</details>
