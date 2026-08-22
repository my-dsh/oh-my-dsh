# Agent Note: 会话等待提醒覆盖层在用户有待办时渲染 Canvas2D 3D 面板

Status: implemented

[English](2026-08-22-session-attention-overlay.md) | 中文

## 问题

后台会话完成 AI 回复、或停在审批 / 计划审阅 / 提问上时，用户在重新打开侧边栏之前得不到页面内的信号。动态原型（`notify-1`）验证了形态——一个订阅 `useSessions` 的 `shell.overlay` 条目，在有待办时显示 3D 动画——但已发布插件无法照此交付：原型从运行时 CDN `<script>` 加载 three.js，是一条不适合可安装包的网络依赖，且 WebGL 渲染路径在逐文件 100% 覆盖率门禁下不可达（jsdom 无 WebGL 上下文）。

## 决策

**已发布包 `@deepseek-ai/dsh-client-ui-session-attention` 在 Canvas2D 上下文上手写投影绘制 3D 效果，而非 three.js。** 粒子位于球面、做 3D 旋转、经透视投影到 2D（`scene.ts`）；帧计算（`computeFrame`）是关于点集与时间的纯函数，`paintFrame` 是唯一的画布触点。投影数学、深度排序与深度衰减均可在无画布下单元测试，因此包在 jsdom 中达成 100% 覆盖率，无网络或 WebGL 依赖。

**所有可绘制元素都以加法混合贴同一张预渲染光晕精灵，且 `paintFrame` 清空完整设备像素位图。** 场景渲染一个小型行星系——旋转的发光粒子壳层围绕呼吸的中心辉光，外侧一条倾斜轨道环上有一颗带渐隐拖尾的彗星，每个粒子按自身相位闪烁——重叠粒子积累的是亮度而非不透明度。若只清 CSS 尺寸区域而位图按 `devicePixelRatio` 放大，任何非 1 DPR 的屏幕都会让旧像素堆积成实心色块，因此清屏使用与位图相同的比率。场景数值常量是经由浏览器内实时原型调校的审美选择，并非推导值。

**覆盖层持续可见，而非徽章。** 条目在有待办期间持续渲染，而非收成需用户点开的点；用户直接看到动画与等待行。每行带有该会话的状态色与本地化种类标签，点击行即打开该会话，浏览器标签页标题加 `(N)` 前缀使提醒在标签页切到后台时仍可见。所有等待会话处理完、所有后台回复打开后，覆盖层整体消失。

**提醒选择与侧边栏状态点同源。** `selectAttention` 从 `useSessions`（与侧边栏点同源的数据流）派生行。`pendingInteraction`（`approval` / `plan-review` / `question`）是琥珀色等待点；`completed` 的后台会话（跑完且当前未选中、尚未打开）是绿色已完成提醒。当前会话不会作为完成项出现；同一会话若有待处理交互则优先于完成。行按种类优先级再按会话 id 排序，至多五行后跟“还有 N 个…”的尾巴。主色跟随当前最高优先级种类；仅完成的面板使用绿色主题。

**无 Host 半边、无 locale 命名空间。** Host 半边为空 apply；本插件是纯展示，不持有 Host 端行为。文案走注入的中文默认值而非标准本地化席位，因此切换语言不会重译面板——接入 `dsh-client-locale` 是一项后续本地化工作。

## 考虑过的替代方案

**按动态原型那样从 CDN `<script>` 加载 three.js 的 WebGL 场景。** 对已发布包被否决：运行时 CDN 加载是一条网络依赖，且 WebGL 渲染路径在逐文件 100% 覆盖率门禁下不可达（jsdom 无 WebGL 上下文）。Canvas2D 保持效果零依赖、可完整测试，同时仍是真正的 3D 投影。

**自动收成角落徽章、用户点击再展开。** 被否决：需求是在有待办期间直接看到动画，而非折叠到一次交互之后。

## 后果

切到后台的标签页用户在标题看到提醒，回到页面看到持续的 3D 面板与每个等待会话的名字和颜色，直到处理完每一个。包向 `packages/bundle/web-app/cordis.patch.yml` 与 web-app manifest 各加一行，assembled-boot 快照固定其注册与 fixture 的待提问行。

## 测试

`attention.client.spec.ts` 覆盖纯选择、key 与完成逻辑；`scene.client.spec.ts` 覆盖投影数学、精灵贴图的 `paintFrame` 与 `createAttentionScene` 生命周期（一帧循环、reduced-motion 静态帧、无 raf 销毁、空上下文无操作）。`panel.client.spec.tsx` 在可注入场景工厂的假 `useSessions` 下渲染 `AttentionPanel`，覆盖空渲染、各提醒种类、完成主题、点击打开、标题打标与恢复、+N 尾巴、reduced-motion、默认文案路径与抛错的场景工厂。`apply.client.spec.tsx` 覆盖 `shell.overlay` 注册、延迟注入、打开会话动作与拆卸。`apps/web/tests/session-attention.snapshot.ts` 以 keyless fixture transport 引导组装好的构建图，固定覆盖层的 wrap 存在、头计数、fixture 的待提问行与已打标的标签页标题。

## 相关

- [槽位系统标准](../architecture/2026-07-22-slot-type-chain-implementation.zh.md)——覆盖层条目使用的 `ctx.slots.inject` 延迟注册。
- [包不变量运行时契约](../architecture/2026-07-19-package-invariant-runtime-contracts.zh.md)——本包遵循的空不变量伴随模式。
