# Agent Note: 共享的 step 计时折叠

Status: implemented

[English](2026-08-20-shared-step-timing-fold.md) | 中文

## Problem

两个消费方用各自独立的状态机从 `session/event` 流折叠相同的 agent-loop 步骤计时：`@deepseek-ai/dsh-session-stats` 的全日志投影与 `@deepseek-ai/dsh-token-usage` 的按请求捕获。双方都各自实现了首 token 打点、own-key 的 `tool/call` → `tool/result` 配对、钳制墙钟计算与重复消息守卫，而且每一侧都靠注释声称与另一侧一致。token-usage 捕获还把记录写入推迟到 `step/end`，而 session-stats 在 `assistant/message` 就收口开放边界——所谓"同一套"折叠实际已漂移成两种形状，只靠测试维持诚实。

## Decision

新建零依赖库包 [`@deepseek-ai/dsh-step-timing`](../../../../packages/util/step-timing)，以每个开放步骤一个纯折叠（`StepTimingFold` 与一组 `stepTiming*` 函数）独家持有：边界、首 token 打点、步骤内配对的工具时间、消息打点、未决调用清理，以及可空时长访问器。所有函数在无变化时返回同一引用，`Object.is` 变更流门控照常工作；纯 JSON 状态可通过持久化缓存往返。

两个消费方现在都把计时算术委托给它：

- **session-stats** 保留轮次/步骤计数、usage 校验与总计累加（模型时间在消息组装时、工具时间在每个 result 时——即其变更流一直对外发出的时刻）。其持久化折叠状态改变形状（`pendingCalls` 移入开放步骤内部），因此 `stateVersion` 从 1 升到 2，旧缓存行重算；wire 视图不变。
- **token-usage** 保留 usage/路由暂存与 `step/end` 写入；暂存存在当且仅当折叠已打上消息戳，这正是写入守卫检查的条件。

两侧的折叠都保持开放直到 `step/end`，因此落在 `assistant/message` 之后的工具结果处处都能累计；session-stats 此前通过顶层 pending 映射配对这些迟到结果，其 turn/end 清理语义由按步作用域以相同结果取代。

## Testing

- `packages/util/step-timing/tests/step-timing.spec.ts`：无操作折叠的引用稳定性、跨重试的首 token 优先、按 callId 的乱序配对、原型名 callId 安全、时钟偏移钳制、重复消息引用同一性、解码需要双打点、turn-end 清理。
- session-stats 全部测试原样通过——包括被钉住的回归（取消步骤计数但不计时、max-tokens 宿主消息不加步）、引用同一性期望与真实组合 loader 测试。
- token-usage 捕获与 store 全部测试原样通过；wire 视图未变，ui-conversation 消费方测试同样通过。

## Alternatives considered

- **把 session-stats 的边界收口移到 `step/end` 并去掉顶层 pending 映射，但不建共享包** —— 否决：只修了两份拷贝中的一份，token-usage 一侧仍要继续手工镜像。
- **把 usage 校验与路由连接一并塞进共享原语** —— 否决：usage 校验是投影独有的持久化日志输入问题，路由连接属于捕获；共享它们会让原语耦合模型词汇。
- **让 token-usage 改读 session-stats 投影而不自己折叠** —— 否决：投影是会话作用域的读模型，而捕获需要每请求一行、以 `(sessionId, turn, step)` 为键的跨会话持久记录；从他处总计派生行会丢失每请求粒度。

## Consequences

- 步骤计时代数有了唯一归属；两份可能无声漂移的事件折叠实现消失，后续消费方（例如 OTel span 后端）直接继承经过测试的边界而不再复制。
- 本变更之前写入的 session-stats 持久化缓存因 `stateVersion` 升级一次性失效并从日志重建。
- [token-usage 看板笔记](2026-08-12-cross-session-token-usage-dashboard.zh.md)中"镜像 session-stats"的表述由共享折叠取代；该笔记的存储事实仍是权威。
