// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TokenUsageDailySummaryView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TokenUsageDashboardInjected } from '../src/client/slots.ts'
import { TokenUsageDashboard } from '../src/client/TokenUsageDashboard.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'

const t: TokenUsageDashboardInjected['t'] = makeTranslate(zh, commonZh)

/** A summary carrying every field the panel renders, including the new turns/LLM/tool columns. */
const SUMMARY: TokenUsageDailySummaryView = {
  date: '2026-08-10',
  groups: [
    {
      provider: 'deepseek', model: 'deepseek-chat',
      requests: 12, turns: 9, llmMs: 681000, toolMs: 124000,
      uncachedInputTokens: 3600, outputTokens: 8650, cacheReadTokens: 9200, cacheWriteTokens: 320,
      ttftMs: 51840, ttftSamples: 12, decodeMs: 64500,
      averageThroughput: 134.105, averageTtftMs: 4320, averageLlmMs: 56750, cacheHitRatio: 0.7188,
    },
  ],
  totals: {
    provider: 'total', model: 'total',
    requests: 12, turns: 9, llmMs: 681000, toolMs: 124000,
    uncachedInputTokens: 3600, outputTokens: 8650, cacheReadTokens: 9200, cacheWriteTokens: 320,
    ttftMs: 51840, ttftSamples: 12, decodeMs: 64500,
    averageThroughput: 134.105, averageTtftMs: 4320, averageLlmMs: 56750, cacheHitRatio: 0.7188,
  },
}

const ok = (value: TokenUsageDailySummaryView) => ({ rpcId: RpcId('fake'), result: { ok: true as const, value } })

function apiMock() {
  return {
    tokenUsage: {
      dailySummary: vi.fn(async () => ok(SUMMARY)),
      dailySummaryRange: vi.fn(async () => ok(SUMMARY)),
      purge: vi.fn(),
    },
  }
}

async function openPanel() {
  await act(async () => {
    screen.getByRole('button', { name: 'Token 消费记录' }).click()
    await Promise.resolve()
  })
}

describe('TokenUsageDashboard', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the turns, avg-time, and tool-time columns in the per-group table', async () => {
    const api = apiMock()
    render(<TokenUsageDashboard api={api} t={t} />)
    await openPanel()
    await waitFor(() => expect(screen.getByText('供应商')).toBeTruthy())
    expect(screen.getByText('轮数')).toBeTruthy()
    expect(screen.getAllByText('平均耗时').length).toBeGreaterThan(0)
    expect(screen.getByText('工具耗时')).toBeTruthy()
    // The chat group's distinct turns (9), its derived average LLM time (56.75s),
    // and summed tool time (2m4s). The grouped row and the totals row can coincide,
    // so these read as at least one occurrence.
    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
    expect(screen.getAllByText('56.8s').length).toBeGreaterThan(0)
    expect(screen.getByText('2m4s')).toBeTruthy()
    expect(api.tokenUsage.dailySummary).toHaveBeenCalledTimes(1)
  })

  it('renders the turns and avg-time KPI cards from the totals row', async () => {
    const api = apiMock()
    render(<TokenUsageDashboard api={api} t={t} />)
    await openPanel()
    await waitFor(() => expect(screen.getByText('总轮数')).toBeTruthy())
    expect(screen.getAllByText('平均耗时').length).toBeGreaterThan(0)
    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
    expect(api.tokenUsage.dailySummary).toHaveBeenCalledTimes(1)
  })
})
