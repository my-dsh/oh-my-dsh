/**
 * The session-attention overlay panel: renders continuously in `shell.overlay`
 * while any session awaits the user's action (approval / plan review / question)
 * or an AI reply finished without being opened since. The animation is a
 * self-contained Canvas2D glowing planet system (see {@link ./scene.ts}); the
 * attention rows are derived from the standard `useSessions` hook with the same
 * data the sidebar status dots use.
 */
import { useEffect, useRef } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  KIND_META, attentionRowsKey, isAllCompleted, selectAttention,
  type AttentionKind, type AttentionRow,
} from './attention.ts'
import {
  createAttentionScene, prefersReducedMotion, type SceneEnv, type SceneDisposer,
} from './scene.ts'
import type { SessionAttentionInjected } from './contract/slots.ts'
import css from './AttentionPanel.module.css'

/** Copy keys: a panel title key, the "+N more" tail key, or a kind label key. */
export type CopyKey = AttentionKind | 'title.action' | 'title.completed' | 'more'

/** Localized copy resolver (key → string, with `{n}` interpolation). */
export type Translate = (key: CopyKey, vars?: { n?: number }) => string

/** Default Chinese copy (used when no translator is injected). */
const DEFAULT_COPY: Record<CopyKey, (vars?: { n?: number }) => string> = {
  'title.action': () => '会话需要你的操作',
  'title.completed': () => '回复完成',
  more: vars => '还有 ' + String(/* v8 ignore next -- more is always called with n */ vars?.n ?? 0) + ' 个会话在等待…',
  approval: () => '等待审批',
  'plan-review': () => '计划待审',
  question: () => '等待回答',
  completed: () => '回复完成',
}

/** Map a kind to its localized kind label. */
function kindLabel(t: Translate, kind: AttentionKind): string {
  return t(kind)
}

/** Props the shell.overlay owner hands the entry (standard `useSessions`). */
export interface AttentionPanelProps {
  /** Standard root-scope session list selector hook. */
  useSessions: SnapshotSelectorHook<SessionListState>
  /** Inject face: open a session when a row is clicked. */
  openSession: SessionAttentionInjected['openSession']
  /** Optional localized translator (defaults to Chinese copy). */
  t?: Translate
  /** Optional scene environment override (tests). */
  env?: SceneEnv
  /** Optional scene factory override (tests); defaults to {@link createAttentionScene}. */
  createScene?: (canvas: HTMLCanvasElement, accent: string, env: SceneEnv) => SceneDisposer
}

/** Maximum rows shown before a "+N more" tail. */
const MAX_ROWS = 5

/**
 * The attention overlay panel. Renders nothing while no session needs attention.
 * @param props - the standard useSessions hook plus the open-session action.
 */
export function AttentionPanel({ useSessions, openSession, t, env, createScene }: AttentionPanelProps) {
  const rows = useSessions(selectAttention, (a, b) => attentionRowsKey(a) === attentionRowsKey(b))
  const translate: Translate = t ?? ((key, vars) => DEFAULT_COPY[key](vars))
  const count = rows.length
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const first = count > 0 ? rows[0] : undefined
  const accent = first !== undefined ? KIND_META[first.kind].color : '#f59e0b'
  const completed = isAllCompleted(rows)

  // Tag the browser tab title with the pending count while attention is owed.
  useEffect(() => {
    /* v8 ignore next 2 -- jsdom always has document; the guard is defensive for non-DOM hosts */
    if (typeof document === 'undefined' || count === 0) return
    const original = document.title
    document.title = '(' + String(count) + ') ' + original
    return () => {
      document.title = original
    }
  }, [count])

  // Start/stop the 3D animation while the panel is visible.
  useEffect(() => {
    if (count === 0) return
    const canvas = canvasRef.current
    /* v8 ignore next -- the canvas always mounts before this effect runs */
    if (canvas === null) return
    const sceneEnv: SceneEnv = env ?? {
      reducedMotion: prefersReducedMotion,
      requestAnimationFrame,
      cancelAnimationFrame,
      isHidden: () => document.hidden,
      onVisibilityChange: (cb) => {
        document.addEventListener('visibilitychange', cb)
        return () => { document.removeEventListener('visibilitychange', cb) }
      },
    }
    const factory = createScene ?? createAttentionScene
    /* v8 ignore next -- defensive initializer; reassigned in both try and catch */
    let dispose: SceneDisposer = () => {}
    try {
      dispose = factory(canvas, accent, sceneEnv)
    } catch {
      dispose = () => {}
    }
    return () => { dispose() }
  }, [count > 0, accent, env, createScene])

  if (count === 0) return <></>

  const shown = rows.slice(0, MAX_ROWS)
  const hidden = count - shown.length
  const headText = (completed ? '✅ ' : '⚡ ') + translate(completed ? 'title.completed' : 'title.action') + ' · ' + String(count)

  return (
    <div className={css.wrap} data-sa3d-wrap>
      <div className={css.panel}>
        <div className={css.head} data-sa3d-head>
          <span>{headText}</span>
        </div>
        <div className={completed ? `${css.canvasBox} ${css.canvasBoxCompleted}` : css.canvasBox}>
          <canvas className={css.canvas} ref={canvasRef} width={244} height={148} />
        </div>
        <div className={css.rows}>
          {shown.map((row: AttentionRow) => {
            const meta = KIND_META[row.kind]
            return (
              <button
                key={row.kind + ':' + row.id}
                className={css.row}
                data-sa3d-row
                data-sa3d-kind={row.kind}
                title={kindLabel(translate, row.kind) + ' · ' + row.title}
                onClick={() => { openSession(row.id) }}
              >
                <span className={css.dot} style={{ background: meta.color }} />
                <span className={css.title} data-sa3d-title>{row.title}</span>
                <span className={css.kind}>{kindLabel(translate, row.kind)}</span>
              </button>
            )
          })}
          {hidden > 0 ? <div className={css.more} data-sa3d-more>{translate('more', { n: hidden })}</div> : null}
        </div>
      </div>
    </div>
  )
}
