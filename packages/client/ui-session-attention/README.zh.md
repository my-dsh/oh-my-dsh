# @deepseek-ai/dsh-client-ui-session-attention

[English](README.md) | 中文

Web GUI 会话提醒覆盖插件：浏览器半边向 root 作用域的 `shell.overlay` 列表槽（由 `dsh-client-ui-layout` 拥有并声明）贡献一个条目。该条目订阅标准 `useSessions` 数据流——与侧边栏状态点同源——在任一会话等待用户操作时渲染一个角色：从右上角边缘探头，跳出来播放与提醒种类对应的跳舞动画，所有会话处理完后缩回只露一小部分。Host 半边为空；本插件是纯展示，不持有任何 Host 端行为。

角色生命周期是四阶段状态机：`peek → enter → dance → exit → peek`。`peek` 阶段只露出角色的一小部分（由 overflow-hidden 容器裁切），基本不占用界面。提醒到来时角色进入 `enter`（带弹性回弹滑出），然后进入 `dance` 播放四种动画之一，所有会话处理完后进入 `exit`（缩回边缘），最后回到 `peek`。有待办时浏览器标签页标题加 `(N)` 前缀，使提醒在标签页切到后台时仍可见。

角色可以是用户提供的 PNG（通过插件 `characterImage` 配置项传入 URL 或 data-URI），也可以在未提供图片时使用程序绘制的默认角色——一个有眼睛、笑容、腮红和短小四肢的圆形小生物。动画引擎从流逝时间和生命周期阶段纯函数地计算每帧的 `translate / rotate / scale / squash` 变换，保持确定性（帧路径内无 `Math.random`）且可在 jsdom 中完整测试。四种舞蹈对应四种提醒种类：`approval` 是焦急的小跳加身体抖动；`plan-review` 是思考的摇摆加歪头，思考窗口期间头顶出现 ✨；`question` 是困惑的左右歪头加 `?` 气泡；`completed` 是庆祝的弹跳、摇摆、旋转加 ✨。角色动画的 RAF 循环在标签页切到后台时暂停，回到前台时从同一时间点恢复。

每个提醒行带有该会话的状态色与本地化种类标签，点击行即在侧边栏打开该会话以便用户处理。行按种类优先级（等待在前）再按会话 id 排序，至多渲染五行，其后跟一条“还有 N 个会话在等待…”的尾巴。

## 配置

`characterImage` 插件配置项接受自定义角色 PNG 的 URL 或 data-URI。不设置时使用程序绘制的默认角色。`cordis.yml` 示例：

```yaml
- id: ui-session-attention
  name: '@deepseek-ai/dsh-client-ui-session-attention'
  config:
    characterImage: 'data:image/png;base64,...'
```

## Model Experience

无。覆盖层渲染既有浏览器会话列表；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- **角色 PNG 加载路径仅在浏览器中可达**——jsdom 的 `Image` 不会触发 `onload`/`onerror`，因此 PNG 绘制路径只在真实浏览器中执行；jsdom 测试始终渲染程序绘制的默认角色。
- **无 locale 命名空间**——文案走注入的中文默认值而非标准本地化席位，因此切换语言不会重译面板。若面板需要翻译，接入 `dsh-client-locale` 是一项后续本地化工作。
