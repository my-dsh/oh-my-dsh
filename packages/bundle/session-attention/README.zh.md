---
description: "消息通知覆盖层作为 profile bundle：当任意会话等待用户操作或后台回复完成未查看时，在 shell.overlay 中显示角色舞蹈动画。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-session-attention`

[English](README.md) | 中文

## 概述

消息通知覆盖层作为 profile bundle：一次安装即插入注册到 `shell.overlay` 的浏览器面板。面板从右上角探出角色，在任意会话等待用户操作（审批 / 计划待审 / 提问）或后台会话回复完成未查看时播放对应类型的动画，待所有会话处理完毕后收回。已挂载 `@deepseek-ai/dsh-web-app` 的 profile 不得安装此 bundle——条目会注册两次并导致加载失败。

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
dsh plugin --profile <name> add @deepseek-ai/dsh-session-attention
dsh plugin --profile <name> remove @deepseek-ai/dsh-session-attention
```

行从内置包集合解析；reconcile 步骤在下次 `dsh web` 启动时激活浏览器面板。面板仅在 web 界面中渲染，因此目标 profile 必须已提供 client 运行时、连接和 `shell.overlay` 布局。需要 `pnpm` 在 `PATH` 上。

### 获得什么

一个 `shell.overlay` 条目（`@deepseek-ai/dsh-client-ui-session-attention`）——角色舞蹈动画面板，显示等待操作和完成回复提醒的会话。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部——点击展开</summary>

patch 文档（[`cordis.patch.yml`](cordis.patch.yml)）插入一行：

| 行 id | 包 | 角色 |
|---|---|---|
| `ui-session-attention` | `@deepseek-ai/dsh-client-ui-session-attention` | 注册到 `shell.overlay` 的浏览器面板 |

面板无 host 半插件、无 Service Definition、无事件；它读取 web 界面已提供的标准 `useSessions` 和 `useSessionPendingInteraction` 数据流。Bundle 的实质是 patch 列表，不携带运行时 API。

</details>

-----

<a id="model-experience"></a>
## Model Experience

无，因为面板是纯浏览器 UI，仅消费会话列表和待操作数据流；不触及任何模型请求。

#### KV Cache effect

无；客户端面板不组装任何 provider 请求。


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **需要 web 界面** — 浏览器面板注册到 `shell.overlay`（由 `@deepseek-ai/dsh-client-ui-layout` 声明）并读取 `useSessions` 和 `useSessionPendingInteraction` 标准 hook，因此此 bundle 叠加在 web 界面 profile 上，不适用于纯 host 或 headless profile。
- **与 `@deepseek-ai/dsh-web-app` 互斥** — 该 bundle 之前包含同一行，因此同时安装两者会注册 `shell.overlay` 条目两次并导致加载失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

覆盖层从 `useSessionPendingInteraction` 标准 hook 读取待操作状态，而非 `SessionListState.byId`——`projectList()` 从不在 host `SessionSummary` 上填充 `pendingInteraction` 字段。参见 [pendingInteraction 数据流修复](../../../.agents/notes/implemented/bug-fix/2026-08-28-session-attention-pending-interaction-fix.zh.md)。

</details>
