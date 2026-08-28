---
description: "零依赖的时区时间工具：用于 token-usage 聚合的本地时区日分桶与格式化。"
kind: "package-reference"
---

# dsh-zoned-time

[English](README.md) | 中文

## 概述

把本地墙钟值转换安全地解析为 IANA 时区内的精确 epoch 瞬时。一个零依赖函数 `resolveZonedWallClock` 独家持有此前被 schedule 规则目标与 token-usage 日窗口重复实现的算法。

## 目录

- [API](#api)
- [用法形态](#usage-shape)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

秋令时 overlap 会得到两个瞬时，文档约定取最早者（重复墙钟的第一次出现）；春令时 gap 吞掉所请求值时返回空。所有瞬时都保持在四位年份可表示范围内；仅因该范围而被丢弃的匹配改由 `outOfRange` 报告。

它是一个**库，不是服务或插件**：没有 `ctx`，不注册任何东西，不持有状态，不发事件。错误身份留给调用方——schedule 把结果映射到自己的类型化 `ScheduleInputError` 代码，token-usage 以自己的消息大声失败——因为 gap 与范围策略是消费方词汇，不是解析机制。

## API

```ts
import { resolveZonedWallClock } from '@deepseek-ai/dsh-zoned-time'
```

| 导出 | 职责 |
|---|---|
| `resolveZonedWallClock(timeZone, wallClock)` | 对所请求的本地字段（`year`、1 起始的 `month`、`day`，可选 `hour`/`minute`/`second`/`millisecond` 默认为零）返回 `{ instants, outOfRange }`。`instants` 升序；当没有瞬时能投影回去（转换 gap、非真实日历值如 2 月 30 日、或只有越界匹配）时为空。`timeZone` 不受支持或平台暴露不出可用 UTC 偏移时抛错。 |
| `ZonedWallClock` | 所请求的本地字段。 |
| `ZonedResolution` | 升序精确瞬时加上四位年份拒绝标记。 |

<a id="usage-shape"></a>
## 使用形态

```ts
import { resolveZonedWallClock } from '@deepseek-ai/dsh-zoned-time'

// The epoch window of one calendar day in the caller's zone.
export function dayWindow(timeZone: string, year: number, month: number, day: number): { start: number; end: number } {
  const midnight = (y: number, m: number, d: number): number => {
    const instant = resolveZonedWallClock(timeZone, { year: y, month: m, day: d }).instants[0]
    if (instant === undefined) throw new Error(`no local midnight in ${timeZone} for ${y}-${m}-${d}`)
    return instant
  }
  return { start: midnight(year, month, day), end: midnight(year, month + 1, day) }
}
```

调用方传入已校验的整数日历字段；非真实或非有限的值产生空结果，而不是从 `Intl` 内部抛异常。偏移在猜测值 ±48h 范围内采样，因此与该值相邻的任何真实转换都会贡献候选。

<a id="model-experience"></a>
## Model Experience

无——本包只把调用方给定的字段解析为 epoch 瞬时，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **正确性受平台 tzdata 约束** —— 解析信任运行时的 ICU 时区数据库；过旧的 ICU 可能错放历史转换，也没有内置时区数据可以回退。
- **四位年份定义域** —— `0001-01-01T00:00:00.000Z` … `9999-12-31T23:59:59.999Z` 之外的瞬时永不返回，只通过 `outOfRange` 标记。
- **不做解析或格式化** —— 本包只解析给定的字段；把用户输入读成 `ZonedWallClock`、把瞬时渲染回文本都留在调用方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

它是一个**库，不是服务或插件**：没有 `ctx`，不注册任何东西，不持有状态，不发事件。错误身份留给调用方——schedule 把结果映射到自己的类型化 `ScheduleInputError` 代码，token-usage 以自己的消息大声失败——因为 gap 与范围策略是消费方词汇，不是解析机制。

</details>
