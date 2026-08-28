# Agent Note: 修复 session-attention pendingInteraction 数据流并提取为独立 bundle

Status: implemented

[English](2026-08-28-session-attention-pending-interaction-fix.md) | 中文

## Problem

消息通知覆盖层在运行时从未显示 `approval` / `plan-review` / `question` 行——只有 `completed` 提醒能工作。覆盖层的 `selectAttention` 从 `SessionListState.byId` 读取 `row.pendingInteraction`，但 `projectList()` 从不填充该字段：host 端的 `SessionSummary`（`types.ts`）没有 `pendingInteraction` 成员，而 `TitledSessionSummary` 继承自 host 类型，所以 `flattenLineage` 的展开操作也不会携带它。该字段是客户端 `SessionSummary` 和 `SessionListEntry` 类型上的死声明——测试通过是因为直接将值注入到 mock fixture 中。

该功能也无法独立安装：与 token-usage（有独立 bundle）不同，消息通知面板内联在 `web-app/cordis.patch.yml` 中，没有独立的 profile bundle。

## Decision

**从 `useSessionPendingInteraction` 标准 hook 读取待操作状态，而非 `SessionListState`。** 覆盖层遵循与 `ui-workspace` 相同的模式：分别调用 `useSessions(s => s)` 和 `useSessionPendingInteraction(s => s)`，在 `useMemo` 中合并两个快照调用 `selectAttention(list, pending)`。`selectAttention` 现在接受一个可选的 `ReadonlyMap<SessionId, { kind: string }>` 参数，通过 `attentionKindOf` 将 domain kind 映射到三种关注状态（镜像 ui-workspace 的 `visiblePendingKind`）。

**移除死字段** `pendingInteraction?`：从客户端 `SessionSummary`（`service.ts`）和 `SessionListEntry`（`lineage.ts`）中删除，以及 `lineage.ts` 中不再使用的 `PendingInteractionStatus` 导入。`PendingInteractionStatus` 类型本身保留——`attention.ts` 用它定义 `AttentionKind`。

**提取面板为独立 bundle** `@deepseek-ai/dsh-session-attention`，包含一个 `cordis.patch.yml` 行（仅客户端面板——无 host 半插件、无 Service Definition、无事件）。从 `web-app/cordis.patch.yml` 和其 `package.json` 依赖中移除该行。通过 `dsh plugin --profile <name> add @deepseek-ai/dsh-session-attention` 安装。

## Consequences

覆盖层现在在运行时显示所有四种关注类型（approval、plan-review、question、completed）。两个功能（token-usage 和 session-attention）均可作为独立 profile bundle 安装到任何 web 界面 profile 上。已挂载 `@deepseek-ai/dsh-web-app` 的 profile 不得同时安装任一 bundle——slot 条目会注册两次。

## Alternatives considered

**在 `projectList()` 中通过将 pendingInteraction mux 快照合并到 host 列表投影中来填充 `pendingInteraction`。** 否决：pendingInteraction 快照存在于客户端会话控制器的 `pendingInteractions` observable（一个 ui-session provide 贡献）中，而非 `projectList()` 消费的 host 列表快照中。将其复制到 `SessionListState.byId` 会创建第二个数据源，与权威的 `useSessionPendingInteraction` hook 不同步，且需要会话控制器在 `projectList` 内订阅自己的 provide 贡献。

**保留客户端 `SessionSummary` 类型上的 `pendingInteraction?` 作为前瞻性声明。** 否决：该字段从未被填充、从未被读取，移除它能让未来的意外读取表现为类型错误而非静默的 `undefined`。

## Related

- [Session-attention overlay](../feature/2026-08-22-session-attention-overlay.zh.md) — 原始功能 note，由此修复更新。
