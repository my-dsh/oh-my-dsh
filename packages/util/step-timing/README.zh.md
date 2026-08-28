---
description: "零依赖的步骤计时工具：用于测量 agent-loop 步骤时长的流逝与分段计时器。"
kind: "package-reference"
---

# dsh-step-timing

[English](README.md) | 中文

## 概述

一个 agent-loop 步骤的纯计时折叠：边界、首 token 打点、按 callId 配对的工具墙钟时间、消息打点，以及可空时长访问器。一个零依赖库独家持有这套代数——此前 `session-stats` 的全日志投影与 `token-usage` 的按请求捕获各自实现了两份——使二者的 TTFT 与 decode 数字不可能再漂移。

## 目录

- [API](#api)
- [用法形态](#usage-shape)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

每个函数都是**纯函数且引用稳定**：未观察到任何变化的折叠返回同一对象，投影变更流因此能用 `Object.is` 门控对外发送；纯 JSON 状态可通过持久化缓存往返。工具配对只匹配本步骤自己的 pending 键——provider 生成的 callId 若与 `Object` 原型属性同名，按未匹配处理，绝不读作继承成员。时长把负时钟偏移钳制为零；解码时间要求首 token 与消息两个打点同时存在。

它是一个**库，不是服务或插件**：没有 `ctx`，不注册任何东西，不持有状态，不发事件。usage 校验、路由连接、轮次/步骤计数与记录写入都留在消费方——那些是持久化日志或捕获的职责，不是计时机制。

## API

```ts
import { stepTimingDecodeMs, stepTimingLlmMs, stepTimingOnMessage, stepTimingOnToken, stepTimingOnToolCall, stepTimingOnToolResult, stepTimingOpen, stepTimingTtftMs, stepTimingWithoutPendingCalls } from '@deepseek-ai/dsh-step-timing'
```

| 导出 | 职责 |
|---|---|
| `stepTimingOpen(turn, step, startTime)` | 在 `step/start` 瞬时打开一个步骤的折叠。 |
| `stepTimingOnToken(fold, time, tokenDelta)` | 只从首个 token delta 打 TTFT；之后的 delta（含重试后）返回同一引用。 |
| `stepTimingOnToolCall(fold, callId, time)` | 在步骤的 pending 映射里记录派发瞬时。 |
| `stepTimingOnToolResult(fold, callId, time)` | 对自身 pending 键配对、累计钳制后的工具墙钟时间并移除条目；未匹配的 result 返回同一引用。 |
| `stepTimingOnMessage(fold, time)` | 打一次组装完成的消息瞬时；重复调用返回同一引用。 |
| `stepTimingWithoutPendingCalls(fold)` | 丢弃未决派发（turn-end 清理）；无操作的折叠返回同一引用。 |
| `stepTimingLlmMs(fold)` / `stepTimingTtftMs(fold)` / `stepTimingDecodeMs(fold)` | 读取钳制后的时长；打点不存在前为 null（`llmMs` 需要消息、`ttftMs` 需要首个 token、`decodeMs` 两者都要）。 |

<a id="usage-shape"></a>
## 使用形态

```ts
import { stepTimingDecodeMs, stepTimingLlmMs, stepTimingOnMessage, stepTimingOnToken, stepTimingOpen } from '@deepseek-ai/dsh-step-timing'

// One step's wall-time facts from controlled event times.
export function stepTimes(events: { at: number; kind: 'start' | 'token' | 'message' }[]): { llmMs: number | null; decodeMs: number | null } {
  let fold = stepTimingOpen(1, 1, events[0]?.at ?? 0)
  for (const event of events) {
    if (event.kind === 'token') fold = stepTimingOnToken(fold, event.at, true)
    if (event.kind === 'message') fold = stepTimingOnMessage(fold, event.at)
  }
  return { llmMs: stepTimingLlmMs(fold), decodeMs: stepTimingDecodeMs(fold) }
}
```

折叠在整个步骤期间保持开放——工具在 assistant 消息组装之后执行，因此落在 `assistant/message` 与 `step/end` 之间的结果仍会计入 `toolMs`。

<a id="model-experience"></a>
## Model Experience

无——本包只把调用方给定的时戳折叠为时长，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **每个折叠只跟踪一个开放步骤** —— 原语只管当前步骤的边界；全日志累计、轮次计数与多步骤状态机都留在消费方。
- **信任消费方的判定** —— "该 chunk 是否为 token delta"由调用方决定（共享的 `isTokenDelta` 助手），调用方对空 delta 策略的调整会直接改变这里的 TTFT。
- **没有重试语义** —— 步骤内的 `llm/retry` 按设计不会重置首 token 边界，与客户端窗口折叠一致；不同策略需要新原语，而不是选项开关。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

它是一个**库，不是服务或插件**：没有 `ctx`，不注册任何东西，不持有状态，不发事件。usage 校验、路由连接、轮次/步骤计数与记录写入都留在消费方——那些是持久化日志或捕获的职责，不是计时机制。

</details>
