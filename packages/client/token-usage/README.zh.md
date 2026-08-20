# @deepseek-ai/dsh-client-token-usage

[English](README.md) | 中文

Web GUI 的 Token 消费记录仪表盘。固定在 shell 右下角的浮动按钮打开一个面板,展示某一日历日的 Token 消耗,数据跨会话聚合并按 `(provider, model)` 分组:输入与输出 Token 总量、请求数、平均消耗速度(加权 tokens/秒)、平均 TTFT(首 token 延迟)、平均缓存命中率。面板带日期选择器(默认今天)与刷新操作。

插件向根作用域的 `shell.overlay` 列表槽(ui-layout 拥有并声明)贡献一个条目,因此仪表盘组合进每一屏而不占用独立的布局区域。组件只通过 inject face 获取数据——wire 客户端的 `tokenUsage` 域(`api.tokenUsage.dailySummary({ date, timeZone })`)与绑定的文案翻译器——绝不通过 `ctx`。面板把浏览器时区(`browserTimeZone`)连同要聚合的每一日一并发送,宿主据此用同一时区界定该日的边界(由该时区推导日期键)。加载生命周期(加载中 / 就绪 / 错误)与所选日期留在组件内部:这里没有任何状态需要跨挂载存活,也没有其它条目读取。

表格主体是按 `(provider, model)` 的分组聚合;跨组总计行渲染在最前并加粗。每个展示值都是宿主返回汇总的纯函数:消耗速度为 `outputTokens / (decodeMs / 1000)`(按 decode 加权),TTFT 为算术平均 `ttftMs / ttftSamples`,缓存命中率为 `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`。宿主在数据穿越 wire 前已推导出这些均值,因此面板与宿主的定义完全一致。

聚合本身位于宿主插件 `@deepseek-ai/dsh-token-usage` 及其 SQLite provider 中;本客户端包仅为展示层。

## 模型体验(Model Experience)

无——仪表盘仅渲染浏览器统计 UI,不触及任何模型请求。

#### KV 缓存影响

无;本包既不组装也不发送 provider 请求。

## 已知限制与待办工作

- **按日的分桶遵循浏览器时区**——宿主插件最初按自身本地时区为每条记录写入 `date` 键,因此读取改为按 epoch 时间界定、再按面板提交的 `timeZone` 重新分桶。面板所展示的“某一天”是权威的:宿主用推导日期键所使用的同一时区界定该日的边界。暂未提供时区控件来让查看者在非浏览器时区下查看某一天;若时区缺失或无法解析,面板会以详情错误失败。
- **刷新为手动**——面板在打开、切换日期以及点击刷新时拉取。不存在 usage 增量的实时推送,因为仪表盘是按需统计而非流式界面。
- **清理仅在宿主侧**——wire 暴露 `tokenUsage.purge` 用于维护,但面板不执行任何破坏性操作;保留期控制推迟到部署给出策略时再做。
