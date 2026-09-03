---
description: "以 profile 组合包形式交付的 Token 消耗看板：在任意 web 表层 profile 上插入宿主侧采集、SQLite provider 与浏览器看板面板。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-token-usage-dashboard`

[English](README.md) | 中文

## 概述

以 profile 组合包形式交付的 Token 消耗看板：一次安装同时提供该功能的前后端两端——宿主侧采集（SQLite provider + session 监听器）和浏览器看板面板。`@deepseek-ai/dsh-web-app` 已包含同样的三行，因此此组合包的存在是为了在不引入整个 web-app 组合包的前提下，为某个未挂载它的 web 表层 profile 补上完整看板。已挂载 `@deepseek-ai/dsh-web-app` 的 profile 不得安装此组合包。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 安装到 profile

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-token-usage-dashboard
dsh plugin --profile <name> remove @deepseek-ai/dsh-token-usage-dashboard
```

浏览器面板只在 web 表层内渲染，因此目标 profile 必须已经提供客户端运行时、连接层与 `shell.overlay` 布局。它叠加在某个 web 表层 profile 上，在 `dsh web` 启动时挂载。要求 `PATH` 上有 `pnpm`，以及提供各命名行所依赖的内置依赖的 `dsh` 安装。

### 获得什么

四行：`tokenUsageStore` 背后的 SQLite provider、追加用量记录的 session/event 监听器、暴露每日汇总的 Typert Remote 服务，以及注册到 `shell.overlay` 的悬浮按钮看板面板。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部——点击展开</summary>

patch 文档（[`cordis.patch.yml`](cordis.patch.yml)）插入四行：

| 行 id | 包 | 角色 |
|---|---|---|
| `token-usage-sqlite` | `@deepseek-ai/dsh-token-usage/sqlite-provider` | `tokenUsageStore` 的 SQLite provider |
| `token-usage` | `@deepseek-ai/dsh-token-usage` | 追加用量记录的 session/event 监听器 |
| `token-usage-remote` | `@deepseek-ai/dsh-token-usage/service` | 暴露每日汇总的 Typert Remote 服务 |
| `ui-token-usage` | `@deepseek-ai/dsh-client-token-usage` | `shell.overlay` 中的浏览器看板面板 |

监听器注入 `tokenUsageStore`，因此它在 provider 挂载后才激活。该组合包的实体是 patch 列表，不携带运行时 API。

</details>

不发布运行时不变量 companion：bundle 的模块不携带任何运行时 API——它的实质内容是 `cordis.patch.yml`，被插入的各包拥有各自的行为及其校验。

-----

<a id="model-experience"></a>
## Model Experience

无。插入的监听器只观察 session 流并持久化 provider 上报的计量数据，面板是浏览器统计 UI；两者都不向模型请求贡献任何内容。

#### KV Cache 影响

无；两条插入的宿主行与客户端面板都不装配、也不发送 provider 请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **需要 web 表层**——浏览器面板注册进 `shell.overlay`（由 `@deepseek-ai/dsh-client-ui-layout` 声明）并读取 `tokenUsage` wire 域，因此此组合包叠加在某个 web 表层 profile 之上，而不是 host-only 或 headless profile。
- **与 `@deepseek-ai/dsh-web-app` 互斥**——后者已包含同样的三行，两者都装会重复注册 `tokenUsageStore` 服务并导致加载失败。
- **按本地时区进行按日分桶**——聚合按宿主的本地时区把记录归入自然日，匹配面板的日期选择器，而不是 UTC。按 locale 配置分桶模式推迟到某个部署提出需求再处理。
- **无保留策略**——store 从不过期数据；增长由 `purge()` 调用约束。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

采集在下次启动时开始，无需配置：每次成功的模型调用追加一条记录，随包安装的浏览器面板通过 wire 的 `tokenUsage` 域展示每日 `(provider, model)` 分组的合计。从 shell 右下角的悬浮按钮打开面板，选择日期后刷新。store 从不自动删除；`tokenUsage.purge(before?)` 删除某个 epoch 毫秒时间戳之前的行，用于保留策略。

</details>
