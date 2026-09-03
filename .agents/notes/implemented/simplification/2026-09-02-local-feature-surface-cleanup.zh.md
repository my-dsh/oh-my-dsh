# Agent Note：alpha.5 合并后清理本地特性面

Status: implemented

[English](2026-09-02-local-feature-surface-cleanup.md) | 中文

## 问题

本 fork 的本地特性提交（token-usage 看板、step-timing/zoned-time 工具库、session-attention）先于上游 `dsh-v0.1.2-alpha.5` 合并落地，与四个仓库门禁产生漂移：

- 五个包发布了空的 `./invariant` companion（`dsh-token-usage`、`dsh-client-token-usage`、`dsh-token-usage-dashboard`、`dsh-step-timing`、`dsh-zoned-time`），各带一个源文件、公开子路径、发布条目、invariant 专属依赖边与 TypeScript 引用——正是 [omit-unneeded-invariant-companions](2026-08-28-omit-unneeded-invariant-companions.zh.md) 对其余 209 个包判定无效的形态。
- `dsh-token-usage` 在 `src/types.ts` 旁提交了编译产物 `types.js`/`types.d.ts`/`.js.map` 残留。
- 四个上游已删除包的构建产物目录（`code-runtime-python`、`agent-spine-demo`、`session-persistence-sqlite`、`tool-subagent-report`）残留在磁盘上，导致 `verify-tool-catalog` 的 `packages/*/tool-*` glob 发现不存在的包。
- `CLAUDE.md`、`packages/CLAUDE.md`（git 符号链接）与 `apps/cli/tests/profiles/acp/cordis.yml` 被检出为包含目标路径的普通文本文件，`verify-cordis-config` 在 ACP profile 处失败。
- 看板违反三条样式/i18n 契约：全圆角未配对 `corner-shape: round`（3 条规则 + ChatView 的回合状态圆点）、1px 中性边框未用 0.5px 发丝线（7 条规则）、33 处在已绑定翻译器旁硬编码英文兜底文案。
- `packages/api/remotes`、`dsh-client-token-usage`、`dsh-client-connection` 把浏览器/类型专属依赖边声明进 `peerDependencies`，违反 client 依赖策略。
- 五个本地包停留在版本 `0.1.2-alpha.1`，而合并后的树为 `0.1.2-alpha.5`。

## 决策

把已记录的上游规则应用到本地表面，而非豁免：

- 按 invariant 规则省略五个空 companion：删除 `src/invariant.ts`、`./invariant` 导出、`lib/invariant.js` 发布条目、`@deepseek-ai/dsh-invariants` 依赖边、tsconfig 引用与 tsdown 条目；在两份 README 的 Model Experience 旁（门禁固定的句子/KV 段落结构之外）写出各包专属的省略原因。
- 删除 `src/types.*` 编译残留；`src/types.ts` 是唯一源码，`./types` 导出解析到构建出的 `lib/types/types.js`。
- `pnpm run clean` 移除已删包的残留目录；重新生成 `tsconfig.base.json` 别名、两语言的文档图与模块图，使生成文件与合并后的树一致。
- 把受损符号链接（`CLAUDE.md`、`packages/CLAUDE.md`、ACP profile 的 cordis.yml）恢复为 git 记录的链接形态。
- 原地修复样式/i18n 契约：为全圆角配对 `corner-shape: round`、把中性边框降到 0.5px 发丝线、把 `t?.('key') ?? 'Fallback'` 收敛为必需的 `t('key')` 调用——`TokenUsageDashboardProps` 变为完整的 inject face（inject 闭包恒绑定 `t` 与 `api`，可选守卫是死代码）。
- `verify-package-dependencies --fix` 把浏览器/类型边移入 devDependencies；本地包版本升到 `0.1.2-alpha.5`。

## 验证

`verify-package-invariants`（39 个 companion 合规）、`verify-cordis-config`（133 个文件）、`verify-client-ui-i18n`（486 个文件）、`verify-package-dependencies`（53 个包）、`rescope-vendor:check`、`doc-sync`（32 门）、`hygiene`（15 门）、`typecheck`、`test:gui`（3919 测试）、受影响包的单元测试（187 测试）与完整 `pnpm run build` 全部通过。既存且无关的失败保持原样：进程绑定套件在本环境失败；`test:web` 持久化重放漂移在合并前提交上同样复现。

## 考虑过的替代方案

- **保留带解释注释的空 companion。** 否决——omit-invariant-companions 决策已对其余 209 个包判此形态无效；fork 的包不获得豁免。
- **为安全保留翻译器兜底。** 否决——`ctx.locale.bind` 在 slot 注册前恒已提供 `t`，`?? 'Fallback'` 分支不可达，且 i18n 门禁的规则（文案只归 locale 所有）正是为阻止这类漂移而存在。
- **在本变更中重录 web 持久化重放快照。** 否决——漂移在合并前提交同样复现，先于本次清理存在，属于特性分支自身的快照工作，不属于合并跟进。

## 后果

五个包现在完全不带 invariant 接线——将来新增需要重新审视两份 README 中的省略原因，并按所属决策发布检查真实关系的 companion。看板的文案完全由 locale 字典所有，缺失的键会让类型检查失败而非静默兜底。生成产物（tsconfig 别名、文档图、模块图）重新跟随合并后的树；今后再合并上游删除时，应先运行 `pnpm run clean` 再跑 tool-catalog 门禁。

## 放弃了什么

没有放弃：被移除的 companion 不安装任何检查，兜底文案在恒绑定的翻译器之后不可达，残留文件没有引用方。
