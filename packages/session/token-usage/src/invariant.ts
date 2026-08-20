/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-token-usage`.
 * @module @deepseek-ai/dsh-token-usage/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-token-usage'

/** Cordis companion plugin name. */
export const name = 'token-usage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the capture fold relies on event relations owned and
 * runtime-checked elsewhere (the agent loop appends exactly one `step/end`
 * per entered step; monotonic host-assigned turn numbers; `assistant/message`
 * carrying its step coordinates and model source), the per-call record is
 * schema-bound at the SQLite column level, and the store contains its own
 * write errors so a capture failure never escapes into the agent loop.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
