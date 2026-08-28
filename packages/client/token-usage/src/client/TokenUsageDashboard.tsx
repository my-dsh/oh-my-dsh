/**
 * TokenUsageDashboard: the floating action button (bottom-right) plus the
 * modal panel it opens. Both live behind one overlay contribution because
 * they are coupled — the FAB's only verb is to open the panel, and the
 * panel renders nothing until opened. The component manages its own fetch
 * lifecycle (loading/ready/error) and the selected date locally; nothing
 * here survives a remount or is read by another entry, so it stays
 * component-local per the slot-system live-data discipline.
 *
 * Data reaches the component through the inject face only (`api`, `t`); no
 * ctx, no subscription machinery. The host store bounds each day by a caller
 * time zone, so the panel sends both the day it wants aggregated and the
 * browser zone that derived it (`browserTimeZone`); the host then buckets by
 * that same zone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  TokenUsageDailySummaryView,
  TokenUsageGroupView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconDataOutline16, IconRefreshOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TokenUsageDashboardInjected } from './slots.ts'
import {
  browserTimeZone, daysAgoLocalKey, endOfLastMonthLocalKey, formatCacheHit,
  formatDuration, formatThroughput, formatTtft, formatTtftSeconds, formatTokens,
  orderedGroups, startOfLastMonthLocalKey, startOfMonth, startOfMonthLocalKey,
  todayLocalKey, yesterdayLocalKey,
} from './format.ts'
import type { DashboardKey } from './locales.ts'
import css from './TokenUsageDashboard.module.css'

type DateMode = 'day' | 'range'

/** Fetch lifecycle phase for the current date's summary. */
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Props delivered by the slot outlet: the inject face spread flat. */
export type TokenUsageDashboardProps = Partial<TokenUsageDashboardInjected>

/**
 * The dashboard overlay entry: a FAB pinned bottom-right, opening a modal
 * panel that shows the daily token-usage summary grouped by (provider, model).
 * @param props - the inject face (api + bound translator).
 */
export function TokenUsageDashboard(props: TokenUsageDashboardProps) {
  const { api, t } = props
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DateMode>('day')
  const [date, setDate] = useState<string>(() => todayLocalKey())
  const [startDate, setStartDate] = useState<string>(() => todayLocalKey())
  const [endDate, setEndDate] = useState<string>(() => todayLocalKey())
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<TokenUsageDailySummaryView | null>(null)

  const load = useCallback(async (options: { mode: DateMode; date?: string; startDate?: string; endDate?: string }) => {
    if (api === undefined) return
    setStatus('loading')
    setError(null)
    try {
      let response
      const timeZone = browserTimeZone()
      if (options.mode === 'range' && options.startDate && options.endDate) {
        response = await api.dailySummaryRange(options.startDate, options.endDate, timeZone)
      } else {
        response = await api.dailySummary(options.date ?? todayLocalKey(), timeZone)
      }
      if (!response.ok) {
        setStatus('error')
        setError(response.error.message)
        return
      }
      setSummary(response.value)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [api])

  // Fetch whenever the panel opens or the selected window changes while open.
  useEffect(() => {
    if (!open) return
    void load({ mode, date, startDate, endDate })
  }, [open, mode, date, startDate, endDate, load])

  return (
    <>
      <button
        type="button"
        className={css.fab}
        aria-label={t?.('fab.label') ?? 'Token usage'}
        onClick={() => { setOpen(true) }}
      >
        <IconDataOutline16 size={18} />
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t?.('panel.title') ?? 'Token usage'}
        closeLabel={t?.('close') ?? 'Close'}
        className={clsx(css.modal)}
        contentClassName={clsx(css.content)}
      >
        <div className={css.toolbar}>
          <div className={css.dateField}>
            <Button
              size="sm"
              variant={mode === 'day' && date === todayLocalKey() ? 'primary' : 'ghost'}
              className={css.preset}
              onClick={() => {
                const today = todayLocalKey()
                setMode('day')
                setDate(today)
              }}
            >
              {t?.('preset.today') ?? 'Today'}
            </Button>
            <Button
              size="sm"
              variant={mode === 'day' && date === yesterdayLocalKey() ? 'primary' : 'ghost'}
              className={css.preset}
              onClick={() => {
                const yesterday = yesterdayLocalKey()
                setMode('day')
                setDate(yesterday)
              }}
            >
              {t?.('preset.yesterday') ?? 'Yesterday'}
            </Button>
            <Button
              size="sm"
              variant={mode === 'range' && startDate === daysAgoLocalKey(6) && endDate === todayLocalKey() ? 'primary' : 'ghost'}
              className={css.preset}
              onClick={() => {
                const today = todayLocalKey()
                const start = daysAgoLocalKey(6)
                setMode('range')
                setStartDate(start)
                setEndDate(today)
              }}
            >
              {t?.('preset.last7') ?? 'Last 7 days'}
            </Button>
            <Button
              size="sm"
              variant={mode === 'range' && startDate === startOfMonthLocalKey() && endDate === todayLocalKey() ? 'primary' : 'ghost'}
              className={css.preset}
              onClick={() => {
                const today = todayLocalKey()
                const start = startOfMonth(today)
                setMode('range')
                setStartDate(start)
                setEndDate(today)
              }}
            >
              {t?.('preset.thisMonth') ?? 'This month'}
            </Button>
            <Button
              size="sm"
              variant={mode === 'range' && startDate === startOfLastMonthLocalKey() && endDate === endOfLastMonthLocalKey() ? 'primary' : 'ghost'}
              className={css.preset}
              onClick={() => {
                const start = startOfLastMonthLocalKey()
                const end = endOfLastMonthLocalKey()
                setMode('range')
                setStartDate(start)
                setEndDate(end)
              }}
            >
              {t?.('preset.lastMonth') ?? 'Last month'}
            </Button>
            <div className={css.dateInputWrap}>
              <svg className={css.dateIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M5.5 1.75V4.75H10.5V1.75H12.75V4.75H14.5V6.5H1.5V4.75H3.25V1.75H5.5Z" fill="currentColor" />
                <path fillRule="evenodd" clipRule="evenodd" d="M0 7.5C0 7.22386 0.223858 7 0.5 7H15.5C15.7761 7 16 7.22386 16 7.5V14.5C16 14.7761 15.7761 15 15.5 15H0.5C0.223858 15 0 14.7761 0 14.5V7.5ZM2 9.75C2 9.33579 2.33579 9 2.75 9C3.16421 9 3.5 9.33579 3.5 9.75C3.5 10.1642 3.16421 10.5 2.75 10.5C2.33579 10.5 2 10.1642 2 9.75ZM5.5 9.75C5.5 9.33579 5.83579 9 6.25 9C6.66421 9 7 9.33579 7 9.75C7 10.1642 6.66421 10.5 6.25 10.5C5.83579 10.5 5.5 10.1642 5.5 9.75ZM9.75 9C9.33579 9 9 9.33579 9 9.75C9 10.1642 9.33579 10.5 9.75 10.5C10.1642 10.5 10.5 10.1642 10.5 9.75C10.5 9.33579 10.1642 9 9.75 9ZM13 9.75C13 9.33579 13.3358 9 13.75 9C14.1642 9 14.5 9.33579 14.5 9.75C14.5 10.1642 14.1642 10.5 13.75 10.5C13.3358 10.5 13 10.1642 13 9.75Z" fill="currentColor" />
              </svg>
              <input
                type="date"
                className={css.dateInput}
                value={mode === 'range' ? startDate : date}
                onChange={(e) => {
                  const value = e.currentTarget.value
                  if (mode === 'range') {
                    setStartDate(value)
                    if (value > endDate) setEndDate(value)
                  } else {
                    setMode('day')
                    setDate(value)
                  }
                }}
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<IconRefreshOutline16 size={14} />}
            disabled={status === 'loading'}
            onClick={() => { void load({ mode, date, startDate, endDate }) }}
            className={css.refreshButton}
          >
            {t?.('refresh') ?? 'Refresh'}
          </Button>
        </div>
        {status === 'loading' && <p className={css.status}>{t?.('loading') ?? 'Loading…'}</p>}
        {status === 'error' && (
          <p className={css.error}>
            {t?.('error') ?? 'Failed to load token usage'}
            {error !== null && `: ${error}`}
          </p>
        )}
        {status === 'ready' && summary !== null && summary.groups.length === 0 && (
          <p className={css.status}>
            {t?.('empty') ?? 'No token usage recorded'}
            {mode === 'range' ? ` (${startDate} ~ ${endDate})` : ` (${date})`}
          </p>
        )}
        {status === 'ready' && summary !== null && summary.groups.length > 0 && (
          <>
            <KpiCards totals={summary.totals} t={t} />
            <SummaryTable summary={summary} t={t} />
          </>
        )}
      </Modal>
    </>
  )
}

function KpiCards({
  totals,
  t,
}: {
  totals: TokenUsageGroupView
  t: ((key: DashboardKey) => string) | undefined
}) {
  const totalInput = totals.uncachedInputTokens
  const cachedInput = totals.cacheReadTokens + totals.cacheWriteTokens
  const totalOutput = totals.outputTokens
  const totalTokens = totalInput + cachedInput + totalOutput
  const cacheHitHint = useMemo(() => {
    if (totals.cacheHitRatio === null) return undefined
    return totals.cacheHitRatio >= 0.8 ? t?.('kpi.cacheHitHighHint') : undefined
  }, [totals.cacheHitRatio, t])

  return (
    <section className={css.kpiSection}>
      <div className={css.kpiGrid}>
        <div className={css.kpiCard}>
          <span className={css.kpiLabel}>{t?.('kpi.totalTokens') ?? 'Total tokens'}</span>
          <span className={css.kpiValue}>{formatTokens(totalTokens)}</span>
          <span className={css.kpiHint}>
            {`${formatTokens(totalInput + cachedInput)} in · ${formatTokens(totalOutput)} out`}
          </span>
        </div>
        <div className={css.kpiCard}>
          <span className={css.kpiLabel}>{t?.('kpi.cacheHit') ?? 'Cache hit'}</span>
          <span className={clsx(css.kpiValue, totals.cacheHitRatio !== null && totals.cacheHitRatio >= 0.8 ? css.cacheHitHigh : undefined)}>
            {formatCacheHit(totals)}
          </span>
          <span className={css.kpiHint}>{cacheHitHint ?? ''}</span>
        </div>
        <div className={css.kpiCard}>
          <span className={css.kpiLabel}>{t?.('kpi.ttft') ?? 'Avg TTFT'}</span>
          <span className={clsx(css.kpiValue, (totals.averageTtftMs ?? 0) >= 3000 ? css.ttftWarn : undefined)}>
            {formatTtftSeconds(totals.averageTtftMs)}
          </span>
          <span className={css.kpiHint}>{t?.('kpi.firstToken') ?? 'First token latency'}</span>
        </div>
        <div className={css.kpiCard}>
          <span className={css.kpiLabel}>{t?.('kpi.totalRequests') ?? 'Requests'}</span>
          <span className={css.kpiValue}>{totals.requests.toLocaleString('en-US')}</span>
          <span className={css.kpiHint}>{t?.('kpi.requestUnit') ?? 'Recorded requests'}</span>
        </div>
        <div className={css.kpiCard}>
          <span className={css.kpiLabel}>{t?.('kpi.turns') ?? 'Turns'}</span>
          <span className={css.kpiValue}>{totals.turns.toLocaleString('en-US')}</span>
          <span className={css.kpiHint}>{t?.('kpi.turnsUnit') ?? 'Recorded turns'}</span>
        </div>
        <div className={css.kpiCard}>
          <span className={css.kpiLabel}>{t?.('kpi.llm') ?? 'Avg time'}</span>
          <span className={css.kpiValue}>{formatDuration(totals.averageLlmMs)}</span>
          <span className={css.kpiHint}>{t?.('kpi.llmHint') ?? 'Avg LLM step time'}</span>
        </div>
      </div>
    </section>
  )
}

/**
 * The grouped summary table. The cross-group totals are now shown in the KPI
 * cards above; the table shows only the per-(provider, model) detail rows.
 */
function SummaryTable({
  summary,
  t,
}: {
  summary: TokenUsageDailySummaryView
  t: ((key: DashboardKey) => string) | undefined
}) {
  const rows = useMemo(() => orderedGroups(summary), [summary])
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead>
          <tr>
            <th className={css.colProvider}>{t?.('col.provider') ?? 'Provider'}</th>
            <th className={css.colModel}>{t?.('col.model') ?? 'Model'}</th>
            <th className={css.numCol}>{t?.('col.turns') ?? 'Turns'}</th>
            <th className={css.numCol}>{t?.('col.uncachedInput') ?? 'Uncached input'}</th>
            <th className={css.numCol}>{t?.('col.cacheRead') ?? 'Cache read'}</th>
            <th className={css.numCol}>{t?.('col.cacheWrite') ?? 'Cache write'}</th>
            <th className={css.numCol}>{t?.('col.output') ?? 'Output'}</th>
            <th className={css.numCol}>{t?.('col.cacheHit') ?? 'Cache hit'}</th>
            <th className={css.numCol}>{t?.('col.throughput') ?? 'Avg speed'}</th>
            <th className={css.numCol}>{t?.('col.ttft') ?? 'Avg TTFT'}</th>
            <th className={css.numCol}>{t?.('col.llm') ?? 'Avg time'}</th>
            <th className={css.numCol}>{t?.('col.tool') ?? 'Tool time'}</th>
            <th className={css.numCol}>{t?.('col.requests') ?? 'Requests'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(group => (
            <GroupRow key={`${group.provider}/${group.model}`} group={group} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One detail table row. */
function GroupRow({
  group,
}: {
  group: TokenUsageGroupView
}) {
  const ttftWarn = (group.averageTtftMs ?? 0) >= 3000
  const cacheHigh = group.cacheHitRatio !== null && group.cacheHitRatio >= 0.8
  return (
    <tr>
      <td className={css.colProvider}>
        <span className={css.badge}>{group.provider}</span>
      </td>
      <td className={css.colModel}>{group.model}</td>
      <td className={css.numCol}>{group.turns}</td>
      <td className={css.numCol}>{formatTokens(group.uncachedInputTokens)}</td>
      <td className={css.numCol}>{formatTokens(group.cacheReadTokens)}</td>
      <td className={css.numCol}>{formatTokens(group.cacheWriteTokens)}</td>
      <td className={css.numCol}>{formatTokens(group.outputTokens)}</td>
      <td className={clsx(css.numCol, cacheHigh ? css.cacheHitHigh : undefined)}>{formatCacheHit(group)}</td>
      <td className={css.numCol}>{formatThroughput(group)}</td>
      <td className={clsx(css.numCol, ttftWarn ? css.ttftWarn : undefined)}>{formatTtft(group)}</td>
      <td className={css.numCol}>{formatDuration(group.averageLlmMs)}</td>
      <td className={css.numCol}>{formatDuration(group.toolMs)}</td>
      <td className={css.numCol}>{group.requests}</td>
    </tr>
  )
}
