import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTokenUsageDatabase, SqliteTokenUsageStore, TOKEN_USAGE_APPLICATION_ID } from '../src/store.ts'
import type { TokenUsageEventRecord } from '../src/types.ts'

const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

async function freshDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-token-usage-'))
  dirs.push(dir)
  return join(dir, 'token-usage.db')
}

/** One minimal record for a (provider, model, turn, step). */
function record(over: Partial<TokenUsageEventRecord> & Pick<TokenUsageEventRecord, 'time' | 'date' | 'provider' | 'model' | 'turn' | 'step'>): TokenUsageEventRecord {
  return {
    sessionId: 's1',
    uncachedInputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: null,
    ttftMs: null,
    llmMs: 0,
    toolMs: 0,
    decodeMs: null,
    ...over,
  }
}

/** Epoch milliseconds for a UTC wall-clock instant. */
function utc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute)
}

const UTC = 'UTC'

describe('SqliteTokenUsageStore', () => {
  it('aggregates per-(provider, model) and computes cross-group totals for one day', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    try {
      const ctx = new Context()
      const store = new SqliteTokenUsageStore(ctx, db)
      const date = '2026-08-10'
      // All three records land inside the UTC 2026-08-10 window [00:00, 24:00).
      const t1 = utc(2026, 8, 10, 1)
      const t2 = utc(2026, 8, 10, 2)
      const t3 = utc(2026, 8, 10, 3)
      store.append(record({ time: t1, date, provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 300, ttftMs: 800, llmMs: 900, toolMs: 500, decodeMs: 2000 }))
      store.append(record({ time: t2, date, provider: 'deepseek', model: 'deepseek-chat', turn: 1, step: 0, uncachedInputTokens: 60, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 40, ttftMs: 1200, llmMs: 700, toolMs: 0, decodeMs: 1000 }))
      store.append(record({ time: t3, date, provider: 'deepseek', model: 'deepseek-reasoner', turn: 1, step: 1, uncachedInputTokens: 200, outputTokens: 300, reasoningTokens: 150, ttftMs: 5000, llmMs: 2000, toolMs: 0, decodeMs: 4000 }))

      const summary = store.dailySummary(date, UTC)
      expect(summary.date).toBe(date)
      expect(summary.groups).toHaveLength(2)
      const chat = summary.groups[0]!
      expect(chat).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', requests: 2, turns: 2, llmMs: 1600, toolMs: 500, uncachedInputTokens: 160, outputTokens: 60, cacheReadTokens: 300, cacheWriteTokens: 40, ttftMs: 2000, ttftSamples: 2, decodeMs: 3000 })
      const totals = summary.totals
      expect(totals).toMatchObject({ provider: 'total', model: 'total', requests: 3, turns: 3, llmMs: 3600, toolMs: 500, uncachedInputTokens: 360, outputTokens: 360, cacheReadTokens: 300, cacheWriteTokens: 40, ttftSamples: 3, decodeMs: 7000 })
      db.close()
      void store
    } finally {
      // db.close() above; nothing else to dispose for this unit test.
    }
  })

  it('returns empty groups for a day with no records', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    const ctx = new Context()
    const store = new SqliteTokenUsageStore(ctx, db)
    const summary = store.dailySummary('1999-01-01', UTC)
    expect(summary.groups).toHaveLength(0)
    expect(summary.totals).toMatchObject({ provider: 'total', model: 'total', requests: 0, uncachedInputTokens: 0, outputTokens: 0 })
    db.close()
  })

  it('replaces (not adds) a record on a duplicate (session, turn, step) key', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    const ctx = new Context()
    const store = new SqliteTokenUsageStore(ctx, db)
    const date = '2026-08-11'
    const t = utc(2026, 8, 11, 6)
    store.append(record({ time: t, date, provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, outputTokens: 10 }))
    store.append(record({ time: t + 1000, date, provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, outputTokens: 99 }))
    const summary = store.dailySummary(date, UTC)
    expect(summary.groups[0]).toMatchObject({ requests: 1, outputTokens: 99 })
    db.close()
  })

  it('purges only records strictly before the cutoff and returns the deleted count', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    const ctx = new Context()
    const store = new SqliteTokenUsageStore(ctx, db)
    const date = '2026-08-12'
    const cutoff = utc(2026, 8, 12, 2)
    store.append(record({ time: cutoff, date, provider: 'p', model: 'm', turn: 0, step: 0 }))
    store.append(record({ time: cutoff + 1000, date, provider: 'p', model: 'm', turn: 1, step: 0 }))
    store.append(record({ time: cutoff + 2000, date, provider: 'p', model: 'm', turn: 2, step: 0 }))
    expect(store.purge(cutoff + 1000)).toBe(1)
    const summary = store.dailySummary(date, UTC)
    expect(summary.totals.requests).toBe(2)
    db.close()
  })

  it('stamps the application id on a fresh database', async () => {
    const path = await freshDbPath()
    openTokenUsageDatabase(path).close()
    const db = openTokenUsageDatabase(path)
    const { application_id } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    expect(application_id).toBe(TOKEN_USAGE_APPLICATION_ID)
    db.close()
  })

  it('buckets by the caller time zone, not the writer date key', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    const ctx = new Context()
    const store = new SqliteTokenUsageStore(ctx, db)
    // 2026-08-18T22:00Z is 2026-08-19 in Asia/Shanghai (UTC+8) but 2026-08-18 in
    // America/Phoenix (UTC-7). Written under any date key, the read must follow
    // the requested zone.
    const t = Date.UTC(2026, 7, 18, 22)
    store.append(record({ time: t, date: '2026-08-18', provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, outputTokens: 42 }))

    const shanghai = store.dailySummary('2026-08-19', 'Asia/Shanghai')
    expect(shanghai.groups[0]).toMatchObject({ requests: 1, outputTokens: 42 })

    const shanghaiEmpty = store.dailySummary('2026-08-18', 'Asia/Shanghai')
    expect(shanghaiEmpty.groups).toHaveLength(0)

    const phoenix = store.dailySummary('2026-08-18', 'America/Phoenix')
    expect(phoenix.groups[0]).toMatchObject({ requests: 1, outputTokens: 42 })
  })

  it('bounds a date range by caller time-zone day boundaries', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    const ctx = new Context()
    const store = new SqliteTokenUsageStore(ctx, db)
    // Two instants one wall day apart in UTC, spanning an Asia/Shanghai boundary.
    const early = Date.UTC(2026, 7, 18, 1) // 2026-08-18 in every zone
    const late = Date.UTC(2026, 7, 19, 1) // 2026-08-19 in UTC / Asia/Shanghai
    store.append(record({ time: early, date: '2026-08-18', provider: 'p', model: 'm', turn: 0, step: 0, outputTokens: 10 }))
    store.append(record({ time: late, date: '2026-08-19', provider: 'p', model: 'm', turn: 1, step: 0, outputTokens: 20 }))

    const utcRange = store.dailySummaryRange('2026-08-18', '2026-08-19', 'UTC')
    expect(utcRange.totals.requests).toBe(2)

    const single = store.dailySummaryRange('2026-08-18', '2026-08-18', 'UTC')
    expect(single.totals.requests).toBe(1)
    expect(single.totals.outputTokens).toBe(10)
  })
})
