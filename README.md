# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

> **Added on top of upstream** — this repository adds two capabilities you won't find in stock DeepSeek Harness: a **token-usage dashboard** and **session-attention reminders**.

## Added features

This repository adds two capabilities on top of the upstream DeepSeek Harness.

### Token usage dashboard

`@deepseek-ai/dsh-token-usage` persists provider-reported usage for every model call into a SQLite-backed store and aggregates it into daily summaries per `(provider, model)` — tokens split into uncached input, cache read, cache write, and output, plus TTFT and wall-time averages. The built-in web dashboard (`packages/bundle/token-usage-dashboard`) surfaces these as cross-session statistics in the Web GUI. See the [token-usage subsystem doc](docs/subsystems/token-usage.md).

![The token-usage dashboard: per-day cross-session statistics grouped by provider and model](docs/media/token-usage-dashboard.png)

### Session attention reminders

When a background session awaits the user — a pending interaction (approval / plan review / question) or a finished AI reply not yet opened — a floating overlay appears in the top-right of the Web GUI. It tags the tab title `(N)` and plays one of four distinct Canvas2D animations keyed by the highest-priority attention kind, so you can tell at a glance what kind of reminder is owed. The plugin is developed in the standalone [`dsh-session-attention` repository](https://github.com/my-dsh/dsh-session-attention); see the [community plugins guide](docs/user/guide/community-plugins.md) for installation.

![The session-attention overlay announcing sessions awaiting the user](docs/media/session-attention.png)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
