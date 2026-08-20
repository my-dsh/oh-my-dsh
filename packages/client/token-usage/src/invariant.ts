/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-token-usage`.
 * @module @deepseek-ai/dsh-client-token-usage/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-token-usage'

/** Cordis companion plugin name. */
export const name = 'client-token-usage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the dashboard is a browser-side pure presentation
 * (FAB + panel) registering into a slot owned by another package; its
 * disposal is proven by the HMR-safety of the slot registration, it emits no
 * cordis events, and owns no cross-plugin mutable state.
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
