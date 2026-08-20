# Agent Note: Defer the token-usage record write to step/end to capture tool wall time

Status: implemented

[English](2026-08-18-defer-token-usage-write-to-step-end.md) | 中文

## 问题

Token 消费记录仪表盘的「工具耗时」列对所有会话都显示 `0`。捕获折叠（由[跨会话 token 使用仪表盘](../architecture/2026-08-12-cross-session-token-usage-dashboard.md)引入）在每个请求的 `assistant/message` 边界事件上写一条 `TokenUsageEventRecord`，但 agent 循环是在追加 `assistant/message` *之后*才派发工具调用（`packages/core/agent-loop/src/agent.ts` 里的 `executeToolCalls`）。在消息组装时刻 `open.toolMs` 仍是 `0`，于是即使是运行了长时间工具调用的步骤，落库的每条记录也携带 `toolMs: 0`。`(session_id, turn, step)` 主键是替换而非追加，所以已写入的行永远保持为零；因此仪表盘对修复之前写入的所有历史都显示零工具耗时，修复只对之后捕获的记录生效。

## 决策

捕获折叠现在把 `assistant/message` 的事实（时间、usage、提供方、模型）暂存到开放式步骤上，并把记录写入推迟到 `step/end`——循环在步骤的所有工具结果落地后，于 `finally` 中发出该事件。`recordFromStashedStep` 从暂存的消息事实，加上开放式步骤累计的 `toolMs`（按 callId 配对的 `tool/call` → `tool/result`）、TTFT 与解码时间来构建记录。重复的组装消息保留第一次暂存的事实；其消息不带 usage 的步骤仍不写记录（其开放式步骤被清空，以免把游离的工具时间计入）；未经历 `step/end` 就到达 `turn/end` 的撕裂式步骤被清空而不写入，避免部分记录泄漏到后面的步骤。

## 备选方案

**抽出一个纯净的、导出的折叠函数，用合成的 `session/event` 载荷来测。** 被否决：那是更宽的 API，也是更不忠实的探针——这个修复的保证恰恰关于真实循环的次序，所以配套测试用 `Session.append` 驱动真实会话并断言观察到的记录，而不是用一个捏造事件时间的独立纯函数。

**在步骤最后一个在途调用的 `tool/result` 处写记录。** 被否决：捕获折叠无法在不使用 `step/end` 边界的情况下得知步骤的调用是否全部完成，而且需要缓冲或猜测。

## 影响

本次改动之后捕获的记录携带真实的工具墙钟时间，与仪表盘把 `toolMs` 求和的列一致；之前的记录携带 `toolMs: 0`。记录的 `time` 仍是 `assistant/message` 的追加时间（保留了路由 join），因此按天分桶及 TTFT/解码语义不变。已有的零值行不会被重写。

捕获的推迟由 `packages/session/token-usage/tests/capture.spec.ts` 固定：该测试在真实会话存储与一个假的 `tokenUsageStore` 旁挂载插件，追加一个带工具配对的完整步骤，并断言非零且精确的 `toolMs`、`llmMs`、`ttftMs` 与 `decodeMs`。