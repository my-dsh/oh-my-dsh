# `@deepseek-ai/dsh-token-usage-dashboard`

English | [中文](README.zh.md)

The Token consumption dashboard as a profile bundle. One install gives both ends of the feature: [`cordis.patch.yml`](cordis.patch.yml) inserts the host-side capture — `token-usage-sqlite` (the independent SQLite provider behind the `tokenUsageStore` Service Definition) and `token-usage` (the session/event listener that appends one per-request usage record per `(provider, model)`) — and the browser panel `ui-token-usage` (`@deepseek-ai/dsh-client-token-usage`, the floating-button dashboard registered into `shell.overlay`). The bundle's substance is the patch list and it carries no runtime API. `@deepseek-ai/dsh-web-app` already includes these same three rows, so this bundle exists to add the full dashboard to a web-surface profile that does not mount it, without pulling in the whole web-app bundle.

## Installation

Install the package into a profile as an out-of-tree bundle; `dsh plugin` initializes the profile on first use and forwards to pnpm in the profile directory, then reconciles the installed package into the profile's bundle layer stack.

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-token-usage-dashboard
```

The browser panel renders only inside a web surface, so the target profile must already provide the client runtime, connection, and `shell.overlay` layout. It is not a standalone application: it composes over a web-surface profile and mounts on a `dsh web` boot. Requires `pnpm` on `PATH` (the forwarder spawns it) and a `dsh` installation that provides the in-box dependencies the rows name.

## Usage

Capture starts on the next boot and needs no configuration: every successful model call appends one record, and the bundled browser panel shows the daily `(provider, model)`-grouped totals (sums plus derived throughput, TTFT, and cache-hit ratio) from the wire `tokenUsage` domain. Open the panel from the floating button at the bottom-right of the shell, pick a date, and refresh.

The installed rows are the same three `@deepseek-ai/dsh-web-app` mounts for this feature, so a profile that already mounts `@deepseek-ai/dsh-web-app` must not also install this bundle — the `tokenUsageStore` service would register twice and fail the load. The store never auto-deletes; `tokenUsage.purge(before?)` drops rows before an epoch-millisecond cutoff for retention.

## Model Experience

None, as the inserted listener only observes the session stream and persists provider-reported accounting, and the panel is a browser statistics UI; nothing here reaches a model request.

#### KV Cache effect

None; neither inserted host row nor the client panel assembles a provider request.

## Known Limitations and Deferred Work

- **A web surface is required** — the browser panel registers into `shell.overlay` (owned by `@deepseek-ai/dsh-client-ui-layout`) and reads the `tokenUsage` wire domain, so this bundle composes over a web-surface profile and not a host-only or headless one.
- **Mutually exclusive with `@deepseek-ai/dsh-web-app`** — that bundle already includes the same three rows, so installing both registers the `tokenUsageStore` service twice and fails the load.
- **Local timezone day bucketing** — the aggregate groups records by calendar day in the host's local timezone, matching the panel's day picker, rather than UTC. A locale-configured bucketing mode is deferred until a deployment states a requirement.
- **No retention policy** — the store never auto-expires data; growth is bounded by `purge()` calls.