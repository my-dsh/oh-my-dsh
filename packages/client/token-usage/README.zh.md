---
description: "Web GUI 的 Token 消耗看板：一个悬浮按钮打开模态面板，按 provider 和 model 聚合显示每日跨会话 token 用量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-token-usage

[English](README.md) | 中文

## 概述

Web GUI 的 Token 消耗看板。固定在 shell 右下角的浮动按钮打开一个模态面板，展示某一日历日的 Token 消耗，数据跨会话聚合并按 `(provider, model)` 分组：四个不相交的 Token 桶、请求数、平均消耗速度、平均 TTFT、平均 LLM 步骤时间与平均缓存命中率。聚合本身位于宿主插件 `@deepseek-ai/dsh-token-usage` 及其 SQLite provider 中；本客户端包仅为展示层。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

插件向根作用域的 `shell.overlay` 列表槽（由 `@deepseek-ai/dsh-client-ui-layout` 拥有并声明）贡献一个条目，因此看板组合进每一屏而不占用独立的布局区域。组件只通过 inject face 获取数据——wire 客户端的 `tokenUsage` 域与绑定的文案翻译器——绝不通过 `ctx`。加载生命周期（加载中 / 就绪 / 错误）与所选日期留在组件内部：这里没有任何状态需要跨挂载存活，也没有其它条目读取。面板把浏览器时区（`browserTimeZone`）连同要聚合的每一日一并发送，宿主据此用同一时区界定该日的边界。

表格主体是按 `(provider, model)` 的分组聚合；跨组总计行渲染在最前并加粗。每个展示值都是宿主返回汇总的纯函数：消耗速度为 `outputTokens / (decodeMs / 1000)`（按 decode 加权），TTFT 为算术平均 `ttftMs / ttftSamples`，缓存命中率为 `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`。宿主在数据穿越 wire 前已推导出这些均值，因此面板与宿主的定义完全一致。跨组总计卡片汇总全部四个桶（计费 Token：未缓存输入加上缓存读、缓存写与输出），而非仅未缓存输入加输出。

不发布运行时不变量 companion：看板是浏览器侧的纯展示（悬浮按钮 + 面板），注册进由其他包拥有的 slot；它不发出任何 cordis 事件、不拥有跨插件可变状态，其注销由 slot 注册的 HMR 安全测试证明。

<a id="model-experience"></a>
## Model Experience

无，因为看板仅渲染浏览器统计 UI，不触及任何模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **按日的分桶遵循浏览器时区**——宿主插件最初按自身本地时区为每条记录写入 `date` 键，因此读取改为按 epoch 时间界定、再按面板提交的 `timeZone` 重新分桶。面板所展示的"某一天"是权威的：宿主用推导日期键所使用的同一时区界定该日的边界。暂未提供时区控件来让查看者在非浏览器时区下查看某一天；若时区缺失或无法解析，面板会以详情错误失败。
- **刷新为手动**——面板在打开、切换日期以及点击刷新时拉取。不存在 usage 增量的实时推送，因为看板是按需统计而非流式界面。
- **清理仅在宿主侧**——wire 暴露 `tokenUsage.purge` 用于维护，但面板不执行任何破坏性操作；保留期控制推迟到部署给出策略时再做。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

面板通过 inject face（`api.tokenUsage.dailySummary({ date, timeZone })`）读取 `tokenUsage` wire 域，而非通过 `ctx`。加载生命周期与所选日期是组件内部状态；未声明 store 或跨条目状态。

</details>
