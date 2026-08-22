// @vitest-environment jsdom
// Assembled session-attention snapshot: boots the real built `packages/
// client/*/lib/client.js` bundles through AppWebEntry's ModuleLoader path
// against the keyless FixtureApiClient transport. The fixture ships a session
// with a pending `question` interaction, so the ui-session-attention overlay
// (shell.overlay entry `session-attention-3d`) renders its attention panel and
// tags the document title. This snapshot pins the two surfaces the overlay
// owns that only the assembled registration reaches — the wrap presence and
// the first row's attention-kind label — so a regression in registration or
// the attention selection folds back into this file.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/session-attention/pending-question.expected.txt')

installAssembledBootEnv()

/** Normalize the attention overlay to stable text fields: the wrap presence,
 *  the head count line, and each visible row's attention-kind label. The
 *  rotating Canvas2D sphere is a draw-only element with no stable text, so the
 *  snapshot pins the panel chrome around it rather than the canvas pixels. */
function attentionShape(wrap: Element): string {
  const rows = [...wrap.querySelectorAll('[data-sa3d-row]')]
  const kindLabels = rows.map((row) => {
    const kind = row.getAttribute('data-sa3d-kind') ?? '<absent>'
    const title = row.querySelector('[data-sa3d-title]')?.textContent?.trim() ?? '<absent>'
    return `row kind=${kind} title=${title}`
  })
  const head = wrap.querySelector('[data-sa3d-head]')?.textContent?.trim() ?? '<absent>'
  const more = wrap.querySelector('[data-sa3d-more]')?.textContent?.trim() ?? '<none>'
  const titleTagged = document.title.startsWith('(')
  return [
    'wrap=present',
    `title-tagged=${String(titleTagged)}`,
    `head=${head}`,
    `rows=${String(rows.length)}`,
    ...kindLabels,
    `more=${more}`,
  ].join('\n')
}

it('renders the attention overlay for the fixture pending question and tags the tab title', async () => {
  mountAssembledApp()

  // The overlay mounts once the session-attention entry activates after the
  // shell declares shell.overlay; the fixture's pending question keeps it up.
  const wrap = await waitFor(() => {
    const found = document.querySelector('[data-sa3d-wrap]')
    expect(found).not.toBeNull()
    return found!
  }, { timeout: 10_000 })

  // The head line and at least one row settle asynchronously from useSessions.
  await screen.findByText(/·/, undefined, { timeout: 10_000 })

  const shape = attentionShape(wrap)
  if (REFRESHING_GOLDEN) {
    mkdirSync(dirname(EXPECTED), { recursive: true })
    writeFileSync(EXPECTED, shape)
  }
  await expect(shape).toMatchFileSnapshot(EXPECTED)
})
