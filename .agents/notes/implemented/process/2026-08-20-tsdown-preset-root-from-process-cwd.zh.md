# Agent Note: tsdown 预设从 `process.cwd()` 解析仓库根目录

Status: implemented

[English](2026-08-20-tsdown-preset-root-from-process-cwd.md) | 中文

## Problem

共享预设 `packages/client/tsdown.client.ts` 通过一个仓库根目录常量来定位工作区清单文件。原始定义使用 `fileURLToPath(new URL('../..', import.meta.url))`，只有当 `import.meta.url` 指向预设文件自身位置（`packages/client/tsdown.client.ts`，位于仓库根目录下两层）时才正确。

`tsdown@0.22.2` 引入 `unrun` 作为默认配置加载器（在原生 TypeScript 不可用时，`auto` 解析为 `unrun`）。`unrun` 打包消费方配置文件并内联预设，然后把 `import.meta.url` 重写为消费方配置文件的 URL，而非预设文件的 URL。对于 `packages/api/remotes/tsdown.config.ts` 的消费方，重写后得到 `new URL('../..', '.../packages/api/remotes/tsdown.config.ts')`，解析结果为 `packages/`，而非仓库根目录；对于 `packages/client/ui-theme/tsdown.config.ts` 则解析为 `packages/client/`。于是 `globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })` 匹配不到任何文件，每个 `workspaceManifest(id)` 查询都抛出 `tsdown: no packages/*/*/package.json declares the name <id>`。首次查询恰好是 `@deepseek-ai/dsh-api-remotes`，所以构建在那里失败，尽管真正的缺陷在预设。

## Decision

预设从 `process.cwd()` 推导 `REPOSITORY_ROOT`。tsdown 在工作区构建期间以仓库根目录作为 `process.cwd()` 评估每个包的配置——`workspaceManifest` 的 JSDoc 已经记录了这个不变量，`scripts/build.ts` 也始终从仓库根目录运行每个构建脚本。因此构建的 cwd 是正确、稳定的仓库根目录来源，与 tsdown 使用哪个配置加载器无关。

## Alternatives considered

**从调用栈解析预设文件位置。** 通过 `new Error().stack` 回溯在 V8 版本间不稳定，给每次构建增加开销，并重复 `process.cwd()` 已经提供的保证。

**在每次 tsdown 调用上固定 `--config-loader tsx`。** 这能避开 `unrun` 的 `import.meta.url` 重写，但强制整个构建使用更慢的加载器，并锁定 tsdown 默认发布的加载器。缺陷在于预设依赖了配置加载器会重写的值，而非加载器的选择本身。

**相对于已知的工作区包计算根目录。** 从消费方配置目录解析 `packages/<group>/<pkg>` 会重新引入同样依赖 `import.meta.url` 的脆弱性，并把 `packages/*/*` 布局硬编码进预设。

## Consequences

预设不再依赖 `import.meta.url`，因此任何保留 `process.cwd()` 的 tsdown 配置加载器（native、tsx、unrun）都会得到相同的仓库根目录。预设的正确性现在依赖于构建始终从仓库根目录运行——`scripts/build.ts` 和 tsdown 的工作区评估都保证了这一点，`workspaceManifest` 的 JSDoc 也已记录。预设中其他对 `import.meta.url` 的使用（`browserSourcePath`）只从 sourcemap 计算相对路径，不受影响。
