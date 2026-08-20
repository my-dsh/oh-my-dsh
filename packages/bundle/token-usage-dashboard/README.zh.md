# `@deepseek-ai/dsh-token-usage-dashboard`

[English](README.md) | 中文

以 profile 组合包形式交付的 Token 消耗看板。一次安装同时提供该功能的前后端两端：[`cordis.patch.yml`](cordis.patch.yml) 插入宿主侧采集——`token-usage-sqlite`（在 `tokenUsageStore` Service Definition 背后打开独立 `token-usage.sqlite` 数据库文件的 SQLite provider）与 `token-usage`（session/event 监听器，为每次请求按 `(provider, model)` 追加一条用量记录）——以及浏览器面板 `ui-token-usage`（`@deepseek-ai/dsh-client-token-usage`，注册进 `shell.overlay` 的悬浮按钮看板）。该组合包的实体是 patch 列表，不携带运行时 API。`@deepseek-ai/dsh-web-app` 已包含同样的三行，因此此组合包的存在是为了在不引入整个 web-app 组合包的前提下，为某个未挂载它的 web 表层 profile 补上完整看板。

## 安装

将一个包作为 out-of-tree 组合包装入某个 profile；`dsh plugin` 在首次使用时初始化该 profile、在 profile 目录内转发给 pnpm，然后把安装好的包调和进 profile 的 bundle 层列表。

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-token-usage-dashboard
```

浏览器面板只在 web 表层内渲染，因此目标 profile 必须已经提供客户端运行时、连接层与 `shell.overlay` 布局。它不是独立的应用程序：它叠加在某个 web 表层 profile 之上，并在 `dsh web` 启动时挂载。要求 `PATH` 上有 `pnpm`（转发器通过它执行），以及提供各命名行所依赖的内置依赖的 `dsh` 安装。

## 使用

采集在下次启动时开始，无需配置：每次成功的模型调用追加一条记录，随包安装的浏览器面板通过 wire 的 `tokenUsage` 域展示每日 `(provider, model)` 分组的合计（总和以及推导出的吞吐、TTFT 与缓存命中率）。从 shell 右下角的悬浮按钮打开面板，选择日期后刷新。

安装的行与 `@deepseek-ai/dsh-web-app` 为本功能挂载的三行相同，因此一个已经挂载 `@deepseek-ai/dsh-web-app` 的 profile 不能再安装此组合包——`tokenUsageStore` 服务会重复注册并导致加载失败。store 从不自动删除；`tokenUsage.purge(before?)` 删除某个 epoch 毫秒时间戳之前的行，用于保留策略。

## 模型体验

无。插入的监听器只观察 session 流并持久化 provider 上报的计量数据，面板是浏览器统计 UI；两者都不向模型请求贡献任何内容。

#### KV Cache 影响

无；两条插入的宿主行与客户端面板都不装配、也不发送 provider 请求。

## 已知限制与暂缓事项

- **需要 web 表层**——浏览器面板注册进 `shell.overlay`（由 `@deepseek-ai/dsh-client-ui-layout` 声明）并读取 `tokenUsage` wire 域，因此此组合包叠加在某个 web 表层 profile 之上，而不是 host-only 或 headless profile。
- **与 `@deepseek-ai/dsh-web-app` 互斥**——后者已包含同样的三行，两者都装会重复注册 `tokenUsageStore` 服务并导致加载失败。
- **按本地时区进行按日分桶**——聚合按宿主的本地时区把记录归入自然日，匹配面板的日期选择器，而不是 UTC。按 locale 配置分桶模式推迟到某个部署提出需求再处理。
- **无保留策略**——store 从不过期数据；增长由 `purge()` 调用约束。