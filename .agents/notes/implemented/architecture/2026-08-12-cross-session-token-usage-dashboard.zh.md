# Agent Note: 跨会话 Token 消费仪表盘

Status: implemented

[English](2026-08-12-cross-session-token-usage-dashboard.md) | 中文

## 问题

用户需要了解跨会话的 Token 消耗情况。现有的 `dsh-token-meter` 插件测量单会话压力以支持压缩决策，但缺少跨会话聚合和 Web UI 展示层。运营者和开发者想要回答：今天用了多少 Token，按供应商和模型如何分布，平均消耗速度和缓存命中率是多少？

数据需要在会话关闭后保留（不像内存中的投影），需要跨所有活跃会话聚合而无需扫描会话日志，需要在 Web GUI 中展示而不污染会话日志或 Agent 循环。

## 决策

### 三件交付架构：宿主插件 + RPC 传输层 + 客户端插件

功能拆分为三个包，均遵循仓库的 capability-seam 模式：

1. **宿主插件**（`@deepseek-ai/dsh-token-usage`，`packages/session/token-usage/`）—— Service Definition（`TokenUsageStore`）加上独立的 SQLite provider 以及一个 `session/event` 监听器，为每个成功的模型调用追加一条使用记录。这是持久化事实源。

2. **集中式 RPC 传输层扩展**（`packages/host/apiproxy/`）—— 三个一元方法（`tokenUsage.dailySummary`、`tokenUsage.dailySummaryRange` 和 `tokenUsage.purge`）添加到现有 apiproxy 层，遵循文档化的扩展点：一个新文件对 + `ApiProxy` 上的一个字段 + 一行 map 行。

3. **客户端插件**（`@deepseek-ai/dsh-client-token-usage`，`packages/client/token-usage/`）—— 一个浮动操作按钮（FAB）和弹出面板，注册到根作用域的 `shell.overlay` 列表槽中，展示按 (provider, model) 分组的日汇总。

4. **聚合 bundle**（`@deepseek-ai/dsh-token-usage-dashboard`，`packages/bundle/token-usage-dashboard/`）—— 一个 profile patch-layer，为任意 profile 插入宿主侧监听器 + SQLite provider。

### 独立数据库的 SQLite 存储

存储拥有自己的 SQLite 数据库文件（不与 session-persistence 或 session-query 共享），使用单调递增的 `SCHEMA_VERSION = 2` 和 application id `0x44535455`（'DSTU'）。这种隔离意味着存储的 schema 演进永远不会耦合到会话持久化或其他 SQLite 消费者。

`token_usage_events` 表为每个 (session, turn, step) 存储一行，使用 `PRIMARY KEY (session_id, turn, step)` 和 `(date, provider, model)` 索引。`INSERT ... ON CONFLICT DO UPDATE` 模式意味着对同一 (session, turn, step) 的重复追加会替换而非复制——宿主的 session-event 重放语义已经保证了幂等事件交付。汇总读取按调用方提交的时区以每条记录精确的 epoch `time` 窗口界定查询（`dailySummary(date, timeZone)`），而非依据写入时的 `date` 键，因此它们无索引地扫描较小的表；在某个部署证明增长需要 `time` 索引之前，这一点被推迟。

### Session-event 监听器镜像 session-stats 投影计时

监听器挂接到 `ctx.on('session/event')`，并通过 WeakMap 跟踪每个会话的打开 (turn, step) 状态。它捕获 `step/start` → 首个 `assistant/chunk`（用于 TTFT 计时）→ `assistant/message`（用于 usage + provider/model 关联）。这与 `session-stats` 投影的计时折叠一致：第一个带 `usage` 字段的 assistant/message 是 token 桶与路由身份共存的唯一关联点。

`append()` 调用自含失败：它捕获写入错误并记录警告，绝不传播进 cordis `session/event` 派发（该派发为 stop-on-throw）。

### Wire 均值是派生的，不是存储的

宿主在数据穿过 wire 前计算三个派生均值：

- **吞吐量**：`outputTokens / (decodeMs / 1000)` —— 按 decode 加权的 tokens/sec，不是按请求数平均。这偏向于实际产出输出的请求。
- **TTFT**：算术平均 `ttftMs / ttftSamples` —— 只有记录了 TTFT 的调用参与计算。
- **缓存命中率**：`cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)` —— 三个输入桶之和等于计费输入。

客户端直接展示这些值，不做二次推导。

### 客户端插件使用 shell.overlay + 组件本地状态

FAB + 面板通过 `ctx.slots.inject('shell.overlay', () => ctx.slots.register(...))` 注册到 ui-layout 拥有的 `shell.overlay` 列表槽。面板的 fetch 生命周期（loading/ready/error）和选中日期是组件本地的：这里没有任何状态需要跨挂载存活，也没有其他条目读取，符合 slot 系统的 live-data 规范（规则 5："只有组件知道它 → 本地状态"）。

inject face 返回 `{ api, t }` —— wire 客户端的 `tokenUsage` 域和绑定的 locale 翻译器。组件从不看到 `ctx`。

### 开发与测试用的 fixture 数据

连接 fixture（`fixture.ts`）返回一个固定的双分组日汇总（deepseek-chat + deepseek-reasoner），带计算好的合计，使仪表盘在 dev 模式和 fixture 驱动的测试中无需运行宿主即可渲染已填充的表格。

## 测试

- **宿主存储单元测试**（`packages/session/token-usage/tests/store.spec.ts`）：覆盖跨分组聚合、空日响应、upsert 语义、purge 和 application-id 标记。每个测试使用带自动清理的临时目录。
- **客户端格式单元测试**（`packages/client/token-usage/tests/format.client.spec.ts`）：覆盖所有格式化辅助函数（token 计数、吞吐量、TTFT、缓存命中率、排序、今日 UTC key）作为纯函数。
- **Typecheck 聚合**：`tsconfig.host.json` 和 `tsconfig.client.json` 均以 0 error 通过。
- **Lint**：oxlint 在所有新增和修改文件上以 0 warning 0 error 通过。
- **Fixture FakeApiClient 桩**：`connection/tests/fake-api.client.ts` 和 `runtime/tests/fake-api.client.ts` 均已更新 `tokenUsage` 成员；两个 apiproxy 测试 fixture 也已更新。

## 考虑过的替代方案

- **查询时扫描会话日志** —— 否决，因为需要为每次仪表盘刷新加载并折叠每个会话的事件日志，复杂度为 O(总会话数 × 每会话事件数)。追加时聚合使查询复杂度为 O(每日期分组数)。
- **使用 session-persistence 的 SQLite 数据库** —— 否决，因为 token-usage schema 是独立的且独立演进。共享数据库耦合迁移时间线并增加 schema 变更的影响范围。
- **客户端聚合来自会话遥测的数据** —— 否决，因为需要每个浏览器标签页在内存中保存所有会话数据，且数据在页面刷新时丢失。宿主是权威来源。
- **存储预计算均值** —— 否决，因为存储的合约是存储原始求和；消费者决定权重。宿主的 `tokenUsageGroupView` 辅助函数在读取时派生均值，当均值语义变更时保持存储 schema 稳定。
- **组件本地 store factory** —— 否决，因为面板的数据是组件本地的（不跨条目共享，不需要跨挂载存活）。`createXXXStore()` 工厂对自包含的按需 fetch 增加了仪式而无收益。

## 后果

- Token 消耗可跨会话查询，无需扫描日志。追加时热路径为每次成功的模型调用一个同步 SQLite INSERT。
- 独立数据库意味着 token-usage 存储可以独立备份、清理或迁移。`tokenUsage.purge(before?)` 方法处理保留策略。
- 客户端面板通过 `shell.overlay` 组合到每个屏幕，无需拥有布局区域。它按需 fetch，在用户点击 FAB 之前不展示任何内容。
- 按调用方时区的日期分桶：写入方按自身本地时区为每行写入 `date` 键，汇总读取则按调用方提交的 `timeZone` 以每条记录精确的 epoch `time` 窗口重新分桶，因此所请求的自然日无论写入方时区如何都是权威的。这些读取无索引地扫描较小的表，这是已接受的取舍，直到某个部署证明需要进一步增长。
- 该功能在 profile 层面通过 `token-usage-dashboard` bundle 选择加入。默认的 `dsh web` 组合通过 web-app bundle 的 patch 包含它。
