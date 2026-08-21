# @deepseek-ai/dsh-token-usage

[English](README.md) | 中文

跨会话 token 用量持久化：一个由 SQLite 支撑的 `TokenUsageStore` Service Definition，从 session 事件流捕获按请求的提供方上报用量，用于按日、按 (provider, model) 聚合。捕获侧经由共享的 `@deepseek-ai/dsh-step-timing` 原语折叠步骤边界（`step/start` → 首个 token chunk → `assistant/message`）——与 `session-stats` 消费的是同一组原语，因此 TTFT 与 decode 时长与会话作用域投影一致——并通过组装完成的消息的 `source` 关联路由（provider/model 随 usage 一起出现在 `assistant/message` 上）。

## 组合方式

```yaml
- name: '@deepseek-ai/dsh-token-usage/sqlite-provider'
  config:
    path: !!js dshHomePath('token-usage.db')
- name: '@deepseek-ai/dsh-token-usage'
```

`sqlite-provider` 条目打开（或创建）数据库，并把一个 `SqliteTokenUsageStore` 注册为 `tokenUsageStore` cordis 服务；默认条目注入该服务并注册 `session/event` 捕获监听器。两个插件都有可用默认值；provider 的 `path` 是唯一必需配置。

## store 约定

`ctx.tokenUsageStore` 暴露三个操作：

- `append(record)` 持久化一条按调用记录的用量。同步且自含失败：它运行在 `session/event` 监听器内部，而 cordis 以 stop-on-throw 方式派发，因此写入失败会被记录并吞掉——绝不传播进 agent loop。
- `dailySummary(date, timeZone)` 聚合指定时区（UTC 或 IANA 名称）`timeZone` 中某一自然日（`YYYY-MM-DD`）的所有已记录调用，按 (provider, model) 分组，并给出跨组合计；store 以该时区下当日的 epoch `time` 窗口界定查询。
- `dailySummaryRange(startDate, endDate, timeZone)` 聚合 `timeZone` 中该半开日范围内的所有记录。
- `purge(before)` 删除 `time` 严格早于 epoch 毫秒截止点的每条记录；返回删除的行数。默认保留策略为无限——store 从不自动过期数据。

## 按调用记录

每 (session, turn, step) 一行：`time`、`date`、`sessionId`、`provider`、`model`、`turn`、`step`、四个不相交的 token 桶（`uncachedInputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`）、可选的 `reasoningTokens`，以及计时事实 `ttftMs`、`llmMs`（从 `step/start` 到组装完成的 `assistant/message` 的 step 墙钟时间）、`toolMs`（落在该 step 内的匹配 `tool/call` → `tool/result` 墙钟时间）与 `decodeMs`（该 step 从未产生首 token 时为 null）。主键为 `(sessionId, turn, step)`，因此同一 step 的重复上报会替换而非追加——与 `token-meter` 的 replace-not-add 语义一致。

## 每日汇总

`dailySummary(date, timeZone)` 返回 `{ date, groups, totals }`。每个分组对四个 token 桶求和、统计 `requests` 与去重 `turns`、对 `llmMs` / `toolMs` 时长求和，并携带 TTFT/decode 合计及其样本计数。`totals` 行是跨组并集（其 `turns` 是各分组去重 turn 数之和，因此可能高估一个横跨多个 provider/model 分组的 turn）。平均值在客户端推导，因此消费方选择加权方式：

- **平均吞吐量**（tokens/sec）= `outputTokens / (decodeMs / 1000)`，一种加权均值，能抵抗单个快速小请求的拉偏。
- **平均 TTFT** = `ttftMs / ttftSamples`，算术平均（每个请求的首 token 等待对用户同等重要）。
- **缓存命中率** = `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`，一种按计费输入加权的比率。

## Schema 版本

数据库携带自己的单调 `SCHEMA_VERSION`（当前为 3），与 session 持久化 schema 相互独立。空数据库初始化到当前版本；其他任何版本一律拒绝而非就地迁移（预发布立场：后端拒绝旧磁盘格式）。`(time)` 索引同时服务于汇总读取与 `purge`——两者都按 epoch `time` 界定行集；写入时的 `date` 列保持为只写元数据。

## 模型体验

无——本包只观察 session 流并持久化 provider 上报的计量数据；它绝不向模型请求贡献任何内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **`date` 列只写不读**——写入方按自身本地时区为每行写入 `date` 键，但所有读取与 purge 都按调用方时区的 epoch `time` 窗口界定行集，已发布的查询从不使用该列；删除它留待下一次破坏性 schema 变更。
- **无保留策略**——store 从不自动删除；增长由 `purge()` 调用约束。自动每日保留推迟到某个部署提出容量要求后再实现。