# 来自 GitHub 的社区插件

[English](community-plugins.md) | 中文

三个在 Harness 仓库之外维护的示例插件可经 `dsh plugin` 从 GitHub 安装。每个项目的 README 才是当前契约，请在使用前对照插件自己的页面进行核对。

这些第三方插件仅作为互操作参考；收录不代表 DeepSeek 的认可、推荐、合作关系或持续支持承诺。

## 安装一个

这些插件安装进 web surface profile（`dsh web` 使用的默认 profile 名叫 `web`）。安装需要 `pnpm` 在 `PATH` 上；两个 release 压缩包安装会随附预构建产物；搜索 provider 还需要 `git` 在 `PATH` 上。

```sh
dsh plugin --profile web add https://github.com/my-dsh/dsh-session-attention/releases/download/dist/dsh-session-attention-dist.tgz
dsh plugin --profile web add https://github.com/my-dsh/dsh-token-usage-dashboard/releases/download/dist/dsh-token-usage-dashboard-dist.tgz
dsh plugin --profile web add github:my-dsh/dsh-web-search-tavily
```

每条命令会报告所安装的包，bundle 会自动加入 profile 的层栈。安装新层后需要重启 DSH 才会生效。

## 这些插件

| 插件 | 用途 | 安装命令 |
|---|---|---|
| [`dsh-session-attention`](https://github.com/my-dsh/dsh-session-attention) | 任意会话等待用户操作或后台回复完成未查看时，在 `shell.overlay` 播放角色舞蹈动画 | `dsh plugin --profile <name> add https://github.com/my-dsh/dsh-session-attention/releases/download/dist/dsh-session-attention-dist.tgz` |
| [`dsh-token-usage-dashboard`](https://github.com/my-dsh/dsh-token-usage-dashboard) | 跨会话 Token 用量看板：事件监听器写入 SQLite，外加 `shell.overlay` 浏览器面板 | `dsh plugin --profile <name> add https://github.com/my-dsh/dsh-token-usage-dashboard/releases/download/dist/dsh-token-usage-dashboard-dist.tgz` |
| [`dsh-web-search-tavily`](https://github.com/my-dsh/dsh-web-search-tavily) | 注册到 `web` 能力缝的 Tavily 后端搜索 provider | `dsh plugin --profile <name> add github:my-dsh/dsh-web-search-tavily` |

session-attention 和 token-usage-dashboard 插件在 web surface 上添加一个 UI 面板；它们基于 web surface profile 组合，且与已挂载相同条目的内置 `@deepseek-ai/dsh-web-app` bundle 互斥。搜索 provider 需要一个 Tavily API key，可写入 DSH 凭据文件（`~/.dsh/.credentials.yaml`）的 `refs:` 下，或在启动环境中导出。

## 更多细节

每个包的 README 都是权威来源，说明其配置面、前置条件和行为：

- [`dsh-session-attention` README](https://github.com/my-dsh/dsh-session-attention)
- [`dsh-token-usage-dashboard` README](https://github.com/my-dsh/dsh-token-usage-dashboard)
- [`dsh-web-search-tavily` README](https://github.com/my-dsh/dsh-web-search-tavily)