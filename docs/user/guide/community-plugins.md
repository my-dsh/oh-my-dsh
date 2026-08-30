# Community plugins from GitHub

English | [中文](community-plugins.zh.md)

Three example plugins maintained outside the Harness repository install from GitHub with `dsh plugin`. Each README in that project is the current contract, so verify a plugin against its own page before relying on it.

These third-party plugins are provided as interoperability examples only. Their presence here does not imply endorsement, recommendation, partnership, or ongoing support by DeepSeek.

## Install one

The plugins install into a web-surface profile (the default profile behind `dsh web` is named `web`). Installing them requires `pnpm` on `PATH`, and the two release-tarball installs ship prebuilt output; the search provider also requires `git` on `PATH`.

```sh
dsh plugin --profile web add https://github.com/my-dsh/dsh-session-attention/releases/download/dist/dsh-session-attention-dist.tgz
dsh plugin --profile web add https://github.com/my-dsh/dsh-token-usage-dashboard/releases/download/dist/dsh-token-usage-dashboard-dist.tgz
dsh plugin --profile web add github:my-dsh/dsh-web-search-tavily
```

Each command reports the installing package, and the bundle joins the profile's layer stack automatically. DSH must restart for a new layer to take effect.

## The plugins

| Plugin | Purpose | Install command |
|---|---|---|
| [`dsh-session-attention`](https://github.com/my-dsh/dsh-session-attention) | A character dance animation in `shell.overlay` while any session awaits the user's action or a background reply finishes unopened | `dsh plugin --profile <name> add https://github.com/my-dsh/dsh-session-attention/releases/download/dist/dsh-session-attention-dist.tgz` |
| [`dsh-token-usage-dashboard`](https://github.com/my-dsh/dsh-token-usage-dashboard) | A cross-session token-usage dashboard: an event-listener capture into SQLite plus a browser panel in `shell.overlay` | `dsh plugin --profile <name> add https://github.com/my-dsh/dsh-token-usage-dashboard/releases/download/dist/dsh-token-usage-dashboard-dist.tgz` |
| [`dsh-web-search-tavily`](https://github.com/my-dsh/dsh-web-search-tavily) | A Tavily-backed search provider registered into the `web` capability seam | `dsh plugin --profile <name> add github:my-dsh/dsh-web-search-tavily` |

The session-attention and token-usage-dashboard plugins add a UI panel on a web surface; they compose over a web-surface profile and are mutually exclusive with the in-box `@deepseek-ai/dsh-web-app` bundle that already mounts the same entries. The search provider requires a Tavily API key, either written into the DSH credential file (`~/.dsh/.credentials.yaml`) under `refs:` or exported in the launching environment.

## More detail

Each package's README is the source of truth and explains its configuration surface, prerequisites, and behavior:

- [`dsh-session-attention` README](https://github.com/my-dsh/dsh-session-attention)
- [`dsh-token-usage-dashboard` README](https://github.com/my-dsh/dsh-token-usage-dashboard)
- [`dsh-web-search-tavily` README](https://github.com/my-dsh/dsh-web-search-tavily)