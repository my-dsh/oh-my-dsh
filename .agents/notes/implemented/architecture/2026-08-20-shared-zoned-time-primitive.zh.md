# Agent Note: 共享的 zoned-time 墙钟原语

Status: implemented

[English](2026-08-20-shared-zoned-time-primitive.md) | 中文

## Problem

"把本地墙钟值转换安全地解析为 epoch 瞬时"这段逻辑存在两份：`@deepseek-ai/dsh-schedule` 的 `resolveLocalInstant`（schedule 规则目标，带 overlap/gap 错误身份）与 `@deepseek-ai/dsh-token-usage` 的私有午夜扫描器（供 `localDayWindow` 的汇总读取使用）。两者实现了同一算法——解析 `Intl` long-offset、围绕 UTC 形状猜测采样偏移、逐字段精确投影验证——仅靠一条"镜像 schedule 包"的注释保持同步。任何一侧的改动都可能让日期边界或规则目标悄悄分叉。

## Decision

新建零依赖库包 [`@deepseek-ai/dsh-zoned-time`](../../../../packages/util/zoned-time)，以 `resolveZonedWallClock(timeZone, wallClock)` 独家持有该算法：返回每个投影后能精确复现所请求墙钟的瞬时（升序），并用 `outOfRange` 标记仅因四位年份边界而被丢弃的匹配。消费方在其上叠加各自语义：

- Schedule 保留 `calendarEpoch` 校验与其类型化 `ScheduleInputError` 代码；gap 以 `invalid_rule` 拒绝，越界匹配以 `time_out_of_range` 拒绝，overlap 取最早瞬时。
- Token-usage 在 `localDayWindow` 中保留日窗口算术；缺失边界瞬时则以自身消息大声失败。

"overlap 取最早瞬时"这一约定现在有了唯一归属——原语契约本身——而不是两个碰巧一致的实现。采样范围也从 token-usage 的 ±24h 扩大到 ±48h，覆盖所有真实 IANA 偏移量级。

## Testing

- `packages/util/zoned-time/tests/zoned-time.spec.ts`：UTC 与固定偏移时区的午夜、显式毫秒字段、春令时 gap 返回空、秋令时 overlap 返回升序双瞬时、用固定偏移 `Etc/GMT±N` 时区验证两位四位年份边界的越界拒绝、非真实日期、非有限字段、不支持的时区大声失败。
- schedule 领域测试套件在接入新原语后全部原样通过，钉住 gap/overlap/越界行为。
- token-usage store 测试套件的聚合与时区分桶用例原样通过。

## Alternatives considered

- **让 token-usage 依赖 `@deepseek-ai/dsh-schedule`** —— 否决：schedule 是能力包，其 peer 会把 agent、session、tool 依赖拖进一个统计包，只为一个私有函数。
- **保留两份副本并互相加注释** —— 否决：重复本已存在且只能无声漂移；注释不是共享契约。
- **改用基于 Temporal 的实现** —— 否决：支持的 engines 范围内没有 `Temporal`；`Intl` 投影方案仍是平台支持的做法。

## Consequences

- 偏移采样、投影验证、范围边界有了唯一归属；schedule 与 token-usage 各自删除了私有副本。
- 之后需要精确 zoned 瞬时的消费方直接调用原语，而不再重写扫描逻辑。
- token-usage store 的 `(time)` 索引修正随同一变更交付，记录见[看板笔记](2026-08-12-cross-session-token-usage-dashboard.zh.md)。
