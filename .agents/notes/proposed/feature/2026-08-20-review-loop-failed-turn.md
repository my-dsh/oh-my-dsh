# Agent Note: Session-scoped review loop for a failed turn

Status: proposed

English | [中文](2026-08-20-review-loop-failed-turn.zh.md)

## Problem

A reviewer that does not see the producing agent's transcript can catch defects the producing agent's own self-check misses — this is the core finding of several external multi-agent review systems and it is real. The question this note answers is narrower: **does DeepSeek Harness need a new plugin to get that benefit, or does the combination of an existing review skill plus a workflow script already reach it?**

Three existing surfaces overlap with an in-session reviewer:

- [`dsh-code-review`](../../../skills/dsh-code-review/SKILL.md) is a skill — guidance a human reviewer or a reviewer-role agent follows. It prescribes *what* to check (interface sides, lifecycle, capability fit, enforcement, bounds, the real entry path) and assumes the reviewer reads the diff independently. It does not run anything.
- `code-review` (the catalog skill listed in this harness session) already runs Standards and Spec reviews in **parallel sub-agents** and reports them side by side. It delegates but does not feed findings back into the producing agent.
- [`subagent-spawn-in-process`](../../../../packages/subagent/subagent-spawn-in-process/src/index.ts) already starts a fresh child that never sees the parent conversation — the amnesia property an independent reviewer needs. [`subagent-fork-in-process`](../../../../packages/subagent/subagent-fork-in-process/src/index.ts) inherits the parent's completed-turn prefix — the property a repair agent needs to act with context.

What none of those provides today is the **closed loop**: a reviewer verdict that returns to the producing agent, a bounded repair turn, and a re-review until pass or iteration cap — all recorded in one session log. The skills point outward at a human reviewer; the subagent providers start children but do not close the loop on the parent's own turn. That gap, not a fresh provider registry or a new orchestrator, is what this note proposes to close.

The temptation this note exists to resist is larger than the gap. A prior design sketch proposed a `dsh-review-council` plugin with its own `models/provider.ts`, `models/router.ts`, `core/orchestrator.ts`, `core/state-machine.ts`, `core/council.ts`, a complexity auto-router, multi-model debate, and a double-blind judge — roughly a second agent harness inside the harness. Most of that re-implements mechanisms that already ship: the LLM capability seam already owns provider/model selection ([`packages/llm/llm/src/call-config.ts`](../../../../packages/llm/llm/src/call-config.ts)); the workflow engine already runs model-authored fan-out ([`packages/workflow`](../../../../packages/workflow/README.md)); Ralph already runs fresh-agent iterative loops ([`tool-ralph`](../../../../packages/workflow/tool-ralph/README.md)). Building a parallel runtime would duplicate those seams and violate the package rules on owned seams and current-consumer evidence. This note scopes the proposal down to the one mechanism that does not exist.

## Proposal

Add one **session-scoped review loop** as a single model-facing workflow and a thin coordination helper — not a plugin family, not a provider registry, not an auto-router. The loop has exactly one mode in its first delivery: the FAST mode from the sketch (one independent reviewer, bounded repair, re-review). Panel, Council, Audit, debate, and double-blind judging are explicitly deferred and are not proposed here.

The loop runs against the **current turn's diff**, not against an arbitrary revision. It activates when the producing agent (or the user) explicitly invokes it for a completed turn that produced file changes. It never runs silently after every turn; the cost model in the sketch (FAST by default, multi-model only on demand) is preserved by making the loop opt-in.

### Roles and freshness

Two agent roles, mapped to the two existing subagent providers:

- **Reviewer** — a fresh child via `subagent-spawn-in-process`. It receives a review bundle (task statement, acceptance criteria, changed files, unified diff, and test/build/lint output) and **nothing else**: no parent transcript, no producing-agent reasoning, no prior reviewer verdicts from the same loop. This is the amnesia property, satisfied by the spawn provider's contract rather than by a new isolation mechanism.
- **Repair agent** — the original producing agent, continued on its own session. When the reviewer returns a rejection, the findings are admitted back to that session as a logged user-role message and the producing agent runs one more turn. Because the producing agent already owns its transcript and workspace, there is no second writer and no competing implementation.

### Review bundle

The bundle is plain JSON assembled by the coordination helper from workspace and git state after the producing turn settles:

- the original task statement and any acceptance criteria captured for the turn;
- the list of changed files;
- the unified diff of the turn's changes;
- the output of the relevant local checks (`pnpm run typecheck`, focused tests, lint) when the producing agent ran them; and
- the current iteration number.

The bundle deliberately omits the parent transcript, the producing agent's reasoning, and any model-visible narration of how the change was reached. The reviewer reasons from the diff and the checks, not from the story of producing it.

### Structured verdict and gating

The reviewer returns a structured verdict through the workflow `agent()` schema option — no bespoke JSON parser is added:

- `verdict`: `approved` | `approved-with-notes` | `rejected`;
- `confidence`: a number;
- a flat list of findings, each with a severity (`p0` | `p1` | `p2` | `p3`), a category, a file and line where applicable, a problem statement, and an evidence level;
- an evidence level per finding (`e0` model inference through `e4` multi-reviewer consensus — only `e0`–`e3` are reachable in FAST mode, since there is one reviewer).

Gating is severity-driven and configurable: by default `p0`/`p1` force a repair turn, `p2` forces a repair turn unless suppressed by configuration, and `p3` never blocks. The same gate decides `approved-with-notes` from `rejected`. A finding marked `e0` at `p3` is the case the loop is specifically built to stop chasing; the evidence level lets the gate discount low-confidence nits without silencing a real defect.

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

`MAX` defaults to `3` and is configured on the loop, not baked in. At `>= MAX` the loop stops and surfaces the open findings to the user instead of silently looping.

### Session-log integrity

The closed loop must not violate *model-visible ⟺ logged*. The reviewer verdict never reaches the producing agent through a side channel. On rejection, the coordination helper admits the findings to the producing session as one ordinary logged `user/message` event (the same admission path any steering message takes); the producing agent's next turn reads it like any other user input. The reviewer run itself is a workflow run whose events are recorded by the workflow engine's normal logging. Nothing model-visible exists that the log cannot reconstruct.

This is the one invariant that makes the loop a candidate for a thin helper rather than "just a prompt": the findings-to-producing-agent admission must be a real durable event, so it needs an owning operation, not an in-memory handoff.

### Model selection

The reviewer is configured through the child agent's `AgentOptions` — provider and model on the existing call-config, not on a new registry. Choosing a reviewer model from a different provider than the producing model is an operator configuration choice (and a good one, to avoid a shared blind spot), but it is expressed in `cordis.yml` / agent options, not in plugin code. No `models/router.ts` is added.

### Where the mechanism lives

The first delivery is **one workflow script plus one coordination helper**, not a package family:

- the workflow script lives under the existing workflow surface (a model-invokable script, the same surface [`tool-workflow`](../../../../packages/workflow/tool-workflow/README.md) already exposes) and encodes the state machine above;
- the coordination helper owns bundle assembly and findings admission; it is the only new code and it is small — bundle assembly reads git and workspace state, and findings admission is one durable-event write.

If, after delivery, real sessions need a `/review` slash command entry point beyond the workflow invocation, the existing [`packages/interaction/commands`](../../../../packages/interaction/commands/README.md) surface is the home; a command is a thin trigger, not a capability seam.

## Alternatives considered

**Build the full `dsh-review-council` plugin family (provider registry, orchestrator, state machine, panel, council, auditor, judge, auto-router).** Rejected for the first delivery. The provider registry duplicates the LLM capability seam; the orchestrator and state machine duplicate the workflow engine; Ralph already demonstrates fresh-agent iterative loops; the panel/council/audit modes have no current consumer and fail the current-consumer-evidence package rule. The one mechanism none of those provide is the closed findings-to-producing-agent admission, so the proposal ships that and nothing more.

**Add Panel, Council, Audit, and a complexity auto-router in the first delivery.** Rejected until a consumer exists. An auto-router that scores task complexity 0–10 and picks FAST/PANEL/COUNCIL needs evidence that the score correlates with needed review depth; without it the router is an unsupported public choice. Debate and double-blind judging add multi-round state that the workflow `agent()` primitive does not carry natively and would require a second orchestration layer. These are recorded as deferral, not as rejected designs — they may justify a later note once the FAST loop has usage evidence.

**Close the loop by reusing the existing `code-review` skill only.** Rejected as insufficient for the loop itself. The skill is guidance; it delegates to sub-agents but defines no admission path back into the producing session and no iteration cap. Running it manually after every turn and pasting findings back by hand is the baseline it replaces.

**Use `subagent-fork-in-process` for the reviewer so it sees parent context.** Rejected for the reviewer role specifically. The amnesia property is the point; a forked reviewer that inherits the producing agent's completed turns would read the reasoning it is meant to judge independently. The fork provider is the right choice for the *repair* continuation only because the producing agent already owns that context.

**Persist reviewer findings in a separate review store.** Rejected. The session log is the authority for everything model-visible; a second store would duplicate durable state and create a reconciliation surface. Findings live as admitted user messages and as workflow-run events, both already logged.

## Acceptance criteria

Promotion from `proposed/` to `implemented/` requires all of the following observed in a real end-to-end run against this repository, not a hand-mounted plugin suite:

- One completed producing turn with file changes, invoked explicitly, runs the loop to a terminal state (approved, approved-with-notes, or human-review at the iteration cap) without manual intervention between states.
- The reviewer sub-agent is started through `subagent-spawn-in-process` and its prompt context demonstrably excludes the producing agent's transcript and reasoning — verified by a keyless snapshot of what the reviewer receives.
- A rejection with a `p0`/`p1` finding admits exactly one logged `user/message` to the producing session, the producing agent runs one repair turn, and the re-review runs against the updated diff; the session log reconstructs every model-visible input.
- The iteration cap (`MAX`) stops the loop and surfaces open findings to the user rather than looping or silently accepting.
- Unloading the workflow and coordination helper disposes every registration through the owning fiber with no leak, verified by the HMR-safety disposal test required of every registry contribution.
- The structured verdict is enforced by the workflow `agent()` schema option; a deliberately malformed verdict fails closed and is treated as a rejected run with a schema error, not as an approval.

## Risks

- **The reviewer may collude with the producing model's blind spots when both use the same provider.** The loop configures the reviewer through `AgentOptions`, so operator misconfiguration (same model producing and reviewing) is possible. The loop does not refuse it, because provider/model selection is an owned seam; the risk is documented in the loop's README rather than enforced in code.
- **`p2` findings can oscillate.** A `p2` that the producing agent "fixes" by restructuring rather than resolving can reappear as a new `p2`. The iteration cap bounds the cost; the cap is the safety net, not reviewer convergence.
- **`e0` findings at `p2` can waste a repair turn on a guess.** The default gate treats severity as authoritative and evidence as a discount on `p3` only. A later configuration that ties `p2` gating to evidence level is a follow-up if usage shows it is needed.
- **Admitting findings as a user message changes the producing agent's prompt budget.** A large finding list consumes tokens; the coordination helper must bound the admitted message and summarize findings rather than echoing every detail.
- **Scope creep toward Panel/Council.** The strongest pressure on this design is to add the deferred modes before the FAST loop has evidence. The acceptance criteria are written so that none of them require those modes; a later note must justify each added mode with a current consumer.
