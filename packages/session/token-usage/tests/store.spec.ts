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
    decodeMs: null,
    ...over,
  }
}

describe('SqliteTokenUsageStore', () => {
  it('aggregates per-(provider, model) and computes cross-group totals for one day', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    try {
      const ctx = new Context()
      const store = new SqliteTokenUsageStore(ctx, db)
      const date = '2026-08-10'
      store.append(record({ time: 1, date, provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 300, ttftMs: 800, decodeMs: 2000 }))
      store.append(record({ time: 2, date, provider: 'deepseek', model: 'deepseek-chat', turn: 1, step: 0, uncachedInputTokens: 60, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 40, ttftMs: 1200, decodeMs: 1000 }))
      store.append(record({ time: 3, date, provider: 'deepseek', model: 'deepseek-reasoner', turn: 0, step: 0, uncachedInputTokens: 200, outputTokens: 300, reasoningTokens: 150, ttftMs: 5000, decodeMs: 4000 }))

      const summary = store.dailySummary(date)
      expect(summary.date).toBe(date)
      expect(summary.groups).toHaveLength(2)
      const chat = summary.groups[0]!
      expect(chat).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', requests: 2, uncachedInputTokens: 160, outputTokens: 60, cacheReadTokens: 300, cacheWriteTokens: 40, ttftMs: 2000, ttftSamples: 2, decodeMs: 3000 })
      const totals = summary.totals
      expect(totals).toMatchObject({ provider: 'total', model: 'total', requests: 3, uncachedInputTokens: 360, outputTokens: 360, cacheReadTokens: 300, cacheWriteTokens: 40, ttftSamples: 3, decodeMs: 7000 })
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
    const summary = store.dailySummary('1999-01-01')
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
    store.append(record({ time: 1, date, provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, outputTokens: 10 }))
    store.append(record({ time: 2, date, provider: 'deepseek', model: 'deepseek-chat', turn: 0, step: 0, outputTokens: 99 }))
    const summary = store.dailySummary(date)
    expect(summary.groups[0]).toMatchObject({ requests: 1, outputTokens: 99 })
    db.close()
  })

  it('purges only records strictly before the cutoff and returns the deleted count', async () => {
    const path = await freshDbPath()
    const db = openTokenUsageDatabase(path)
    const ctx = new Context()
    const store = new SqliteTokenUsageStore(ctx, db)
    const date = '2026-08-12'
    store.append(record({ time: 100, date, provider: 'p', model: 'm', turn: 0, step: 0 }))
    store.append(record({ time: 200, date, provider: 'p', model: 'm', turn: 1, step: 0 }))
    store.append(record({ time: 300, date, provider: 'p', model: 'm', turn: 2, step: 0 }))
    expect(store.purge(200)).toBe(1)
    const summary = store.dailySummary(date)
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
})
