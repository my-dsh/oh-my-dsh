# Agent Note: 针对失败轮次的会话级 review 闭环

Status: proposed

[English](2026-08-20-review-loop-failed-turn.md) | 中文

## Problem

看不到产出 agent 自身对话历史的 reviewer，能抓到该 agent 自检漏掉的缺陷——这是多个外部多模型 review 系统的核心发现，且确实成立。本 note 回答的问题更窄:**DeepSeek Harness 是否需要为此新建一个插件，还是"现有 review skill + 一段 workflow 脚本"已经能达到同样效果?**

三个现有面与会话内 reviewer 重叠:

- [`dsh-code-review`](../../../skills/dsh-code-review/SKILL.md) 是一个 skill——人类 reviewer 或 reviewer 角色 agent 遵循的指南。它规定了**查什么**(接口两侧、生命周期、capability fit、enforcement、bounds、real entry path),并默认 reviewer 独立阅读 diff。它本身不执行任何东西。
- `code-review`(本 harness 会话中列出的 catalog skill)已经在**并行 sub-agent** 中运行 Standards 与 Spec 两个 review 并并排报告。它会委托，但不会把发现回馈给产出 agent。
- [`subagent-spawn-in-process`](../../../../packages/subagent/subagent-spawn-in-process/src/index.ts) 已经会启动一个不看到父对话的 fresh 子 agent——这正是独立 reviewer 所需的"失忆"属性。[`subagent-fork-in-process`](../../../../packages/subagent/subagent-fork-in-process/src/index.ts) 则继承父 agent 已完成轮次的前缀——这是修复 agent 带上下文行动所需的属性。

这三者今天都不提供**闭环**:reviewer 的判定回到产出 agent、一轮有界修复、再复审直到通过或到达迭代上限——全部记录在同一条 session log 里。skills 指向外部的人类 reviewer;subagent provider 能起子 agent，但不在父 agent 自己的轮次上闭合循环。这个缺口，而不是一个新的 provider registry 或新的 orchestrator，才是本 note 打算补上的东西。

本 note 要抵抗的诱惑比这个缺口更大。此前的一份设计草稿提出过一个 `dsh-review-council` 插件，自带 `models/provider.ts`、`models/router.ts`、`core/orchestrator.ts`、`core/state-machine.ts`、`core/council.ts`、复杂度自动 router、多模型辩论、双盲 judge——大致是 harness 之内又造了一个 harness。其中大部分在重造已有机制:LLM capability seam 已经管 provider/model 选择([`packages/llm/llm/src/call-config.ts`](../../../../packages/llm/llm/src/call-config.ts));workflow engine 已经跑 model-authored fan-out([`packages/workflow`](../../../../packages/workflow/README.zh.md));Ralph 已经跑 fresh-agent 迭代循环([`tool-ralph`](../../../../packages/workflow/tool-ralph/README.zh.md))。造一套并行的运行时会重复这些 seam，并违反关于"拥有单一 seam"与"current-consumer evidence"的 package 规则。本 note 把提案收窄到那一个尚不存在的机制。

## Proposal

新增一个**会话级 review 闭环**，形态是一个 model-facing workflow 加一个薄的协调 helper——不是一个插件家族，不是一个 provider registry，不是一个 auto-router。第一版只有草稿里的 FAST 模式(一个独立 reviewer、有界修复、再复审)。Panel、Council、Audit、辩论、双盲 judge 都明确推迟，不在本提案内。

闭环针对的是**当前轮次的 diff**，不是任意 revision。它在产出 agent(或用户)对某个产生了文件改动的已完成轮次显式调用时激活。它绝不在每个轮次后静默运行;草稿里的成本模型(默认 FAST，多模型仅按需)通过"闭环是 opt-in"来保留。

### Roles and freshness

两个 agent 角色，映射到两个已有的 subagent provider:

- **Reviewer**——通过 `subagent-spawn-in-process` 起的 fresh 子 agent。它只拿到一个 review bundle(任务陈述、验收标准、改动文件、unified diff、test/build/lint 输出)，**别无其他**:没有父 transcript，没有产出 agent 的 reasoning，没有同一闭环此前各轮 reviewer 的判定。"失忆"属性由 spawn provider 的契约满足，而不是新增隔离机制。
- **Repair agent**——原来的产出 agent，在它自己的 session 上继续。reviewer 返回拒绝时，发现会以一条 logged 的 user-role message 回灌到该 session，产出 agent 再跑一轮。因为产出 agent 已经持有自己的 transcript 和 workspace，不存在第二个写入方，也不存在竞争性的另一份实现。

### Review bundle

bundle 是普通 JSON，由协调 helper 在产出轮次 settle 后从 workspace 与 git 状态组装:

- 原始任务陈述，以及为该轮次捕获的任何验收标准;
- 改动文件列表;
- 该轮改动的 unified diff;
- 产出 agent 运行过的相关本地检查(`pnpm run typecheck`、聚焦测试、lint)的输出;以及
- 当前迭代轮次编号。

bundle 刻意省略父 transcript、产出 agent 的 reasoning，以及任何关于"这个改动是怎么做出来的"的 model-visible 叙述。reviewer 从 diff 与检查结果推理，而不是从产出过程的叙述推理。

### Structured verdict and gating

reviewer 通过 workflow `agent()` 的 schema 选项返回结构化判定——不新增专门的 JSON 解析器:

- `verdict`:`approved` | `approved-with-notes` | `rejected`;
- `confidence`:一个数值;
- 一个扁平的 findings 列表，每条带 severity(`p0` | `p1` | `p2` | `p3`)、category、适用的 file 与 line、问题描述、evidence level;
- 每条 finding 的 evidence level(`e0` 模型推断 到 `e4` 多 reviewer 一致——FAST 模式只有一个 reviewer，故只可能落到 `e0`–`e3`)。

gating 由 severity 驱动且可配置:默认 `p0`/`p1` 强制修复轮，`p2` 在未被配置抑制时强制修复轮，`p3` 永不阻塞。同一个 gate 也区分 `approved-with-notes` 与 `rejected`。一条标为 `e0` 的 `p3` 正是这个闭环专门要停止追逐的情形;evidence level 让 gate 能在不沉默真实缺陷的前提下，折扣掉低置信度的 nit。

### State machine

```
START
  │
  ▼
MAIN_EXECUTE (producing agent turn settles)
  │
  ▼
BUILD_BUNDLE (coordination helper assembles diff + checks)
  │
  ▼
REVIEW (fresh reviewer sub-agent, structured verdict)
  │
  ├───────────────┐
 PASS             FAIL (gate says repair)
  │               │
  ▼               ▼
 DONE       CHECK_ITERATION
              │
        ┌─────┴─────┐
        │           │
      < MAX       >= MAX
        │           │
        ▼           ▼
   MAIN_REPAIR  HUMAN_REVIEW
        │
        ▼
   (findings admitted as logged user message → producing agent turn)
        │
        ▼
   BUILD_BUNDLE → REVIEW
```

`MAX` 默认为 `3`，配置在闭环上，不是硬编码。到 `>= MAX` 时闭环停止并向用户暴露未闭合的 findings，而不是静默循环。

### Session-log integrity

闭环不得违反"model-visible ⟺ logged"。reviewer 判定绝不通过旁路到达产出 agent。拒绝时，协调 helper 把 findings 作为一条普通的 logged `user/message` event 回灌到产出 session(任何 steering message 都走的那条 admission path);产出 agent 的下一轮像读任何用户输入一样读它。reviewer 运行本身是一次 workflow run，其事件由 workflow engine 的常规日志记录。任何 model-visible 的东西都能从 log 重建。

这是把闭环判定为"薄 helper"而非"只是一个 prompt"的那条唯一不变量:findings 到产出 agent 的回灌必须是一次真正的 durable event，因此它需要一个归属的 operation，而不是内存中的交接。

### Model selection

reviewer 通过子 agent 的 `AgentOptions` 配置——provider 与 model 落在已有的 call-config 上，而不是一个新的 registry。为 reviewer 选一个与产出模型不同 provider 的模型是 operator 的配置选择(也是好选择，可避开共享的 blind spot)，但它用 `cordis.yml` / agent options 表达，而不是写进插件代码。不新增 `models/router.ts`。

### Where the mechanism lives

第一版是**一个 workflow 脚本加一个协调 helper**，不是一个 package family:

- workflow 脚本落在已有的 workflow 面([`tool-workflow`](../../../../packages/workflow/tool-workflow/README.zh.md) 已经暴露的那个 model-invokable 面)上，编码上面的状态机;
- 协调 helper 拥有 bundle 组装与 findings 回灌;它是唯一新增的代码，而且很小——bundle 组装读 git 与 workspace 状态，findings 回灌是一次 durable-event 写入。

交付之后，如果真实会话除了 workflow 调用之外还需要一个 `/review` slash command 入口，已有的 [`packages/interaction/commands`](../../../../packages/interaction/commands/README.zh.md) 面是它的归属;command 是一个薄触发器，不是 capability seam。

## Alternatives considered

**构建完整的 `dsh-review-council` 插件家族(provider registry、orchestrator、state machine、panel、council、auditor、judge、auto-router)。** 首版否决。provider registry 与 LLM capability seam 重复;orchestrator 与 state machine 与 workflow engine 重复;Ralph 已经演示了 fresh-agent 迭代循环;panel/council/audit 模式没有 current consumer，违反 current-consumer-evidence 的 package 规则。三者都不提供的那一个机制是闭合的 findings-to-producing-agent 回灌，因此提案只交付这个，不多不少。

**首版同时加 Panel、Council、Audit 以及一个复杂度 auto-router。** 在有 consumer 之前否决。一个把任务复杂度打 0–10 分并选 FAST/PANEL/COUNCIL 的 auto-router，需要证据表明该分数与所需审查深度相关;没有证据时，router 是一个无支撑的公开选择。辩论与双盲 judge 引入的多轮状态是 workflow `agent()` 原生不携带的，会需要第二层 orchestration。这些作为推迟记录，而非被否决的设计——一旦 FAST 闭环有了使用证据，它们可能需要一份后续 note。

**只用已有的 `code-review` skill 来闭合循环。** 对闭环本身而言否决为不足。skill 是指南;它会委托 sub-agent，但不定义回灌到产出 session 的 admission path，也没有迭代上限。每轮之后手动跑它再把 findings 粘回去，正是它要取代的基线。

**用 `subagent-fork-in-process` 当 reviewer，让它看到父上下文。** 专对 reviewer 角色否决。"失忆"是全部意义所在;一个继承产出 agent 已完成轮次的 forked reviewer 会读到它本应独立判断的 reasoning。fork provider 只对 *修复* 续跑才正确，因为产出 agent 本就持有那份上下文。

**把 reviewer findings 持久化到一个独立的 review store。** 否决。session log 是一切 model-visible 东西的权威;第二个 store 会重复 durable 状态并制造一个对账面。findings 以被回灌的 user message 与 workflow-run event 的形式存在，二者均已落日志。

## Acceptance criteria

从 `proposed/` 提升到 `implemented/` 要求以下各项在本仓库的一次真实端到端运行中观察到，而非手挂的插件套件:

- 一次带文件改动的已完成产出轮次，被显式调用后，闭环跑到终态(approved、approved-with-notes、或到达迭代上限时的 human-review)，状态之间无需人工干预。
- reviewer sub-agent 通过 `subagent-spawn-in-process` 启动，且其 prompt 上下文可证明排除了产出 agent 的 transcript 与 reasoning——通过一张 keyless snapshot 验证 reviewer 实际收到了什么。
- 一条带 `p0`/`p1` finding 的拒绝，向产出 session 精确回灌一条 logged `user/message`，产出 agent 跑一轮修复，复审针对更新后的 diff 运行;session log 可重建每一个 model-visible 输入。
- 迭代上限(`MAX`)停止闭环并把未闭合 findings 暴露给用户，而不是循环或静默接受。
- 卸载 workflow 与协调 helper 时，通过持有 fiber dispose 掉每一个 registration 且无泄漏，由每个 registry contribution 都要求的 HMR-safety disposal 测试验证。
- 结构化判定由 workflow `agent()` 的 schema 选项强制;一条刻意构造的畸形判定 fail closed，被当作一次带 schema error 的 rejected run 处理，而不是一次 approval。

## Risks

- **reviewer 与产出模型共用一个 provider 时，可能共享 blind spot。** 闭环通过 `AgentOptions` 配置 reviewer，故 operator 的错误配置(产出与审查同一模型)是可能的。闭环不拒绝它，因为 provider/model 选择是一个被拥有的 seam;该风险写进闭环的 README 而不在代码中强制。
- **`p2` 的 findings 可能反复。** 一条被产出 agent 用"重构"而非"解决"处理的 `p2` 可能以新的 `p2` 重新出现。迭代上限约束成本;上限是安全网，不是 reviewer 收敛保证。
- **`e0` 的 `p2` findings 可能让一轮修复白跑在猜测上。** 默认 gate 以 severity 为权威，evidence 仅作为 `p3` 上的折扣。若使用证据表明需要，把 `p2` gating 绑到 evidence level 的配置是后续工作。
- **把 findings 作为 user message 回灌会改变产出 agent 的 prompt 预算。** 一份大的 finding 列表会消耗 token;协调 helper 必须给被回灌消息设限，并概述 findings，而不是逐条复述。
- **向 Panel/Council 的范围蔓延。** 对本设计最强的压力，是在 FAST 闭环拿到证据之前就加回被推迟的模式。acceptance criteria 的写法使它们没有一个需要那些模式;每一项新增模式都必须由一份后续 note 以 current consumer 论证。
