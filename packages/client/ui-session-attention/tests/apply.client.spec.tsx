/** Session-attention slot registration into the root-scoped shell.overlay list. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-session-attention/client'
import type { SessionAttentionInjected } from '@deepseek-ai/dsh-client-ui-session-attention/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const sessions = { open: vi.fn() }
  ctx.provide('sessions', sessions as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots, sessions }
}

describe('ui-session-attention apply', () => {
  it('declares only the slots service', () => {
    expect(inject).toEqual(['slots'])
  })

  it('injects one entry into shell.overlay and builds an open-session action', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
    const entry = b.slots.entries('shell.overlay')[0]!
    expect(entry.options).toMatchObject({ id: 'session-attention-3d', order: 80 })
    const injected = (entry.inject as unknown as () => SessionAttentionInjected)()
    injected.openSession('s1')
    expect(b.sessions.open).toHaveBeenCalledWith('s1')
    // A missing sessions service does not throw (the action no-ops).
    const noopCtx = new Context()
    await noopCtx.plugin(SlotRegistry).await()
    noopCtx.provide('sessions', undefined)
    const noopSlots = noopCtx.get('slots') as SlotRegistry
    noopSlots.register(
      { name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    await noopCtx.plugin({ inject: [...inject], apply }).await()
    const noopInjected = (noopSlots.entries('shell.overlay')[0]!.inject as unknown as () => SessionAttentionInjected)()
    expect(() => { noopInjected.openSession('x') }).not.toThrow()
  })

  it('fails when no live owner declared the shell.overlay slot', async () => {
    // `slots.inject` defers the registration until the parent slot is declared;
    // a root that never declares `shell.overlay` neither errors nor surfaces an
    // entry — the contribution simply waits. The entry appears the moment the
    // parent is declared (asserted by the prior test).
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    // Declaring the parent now surfaces the waiting entry without re-applying.
    b.slots.register(
      { name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
  })

  it('removes the entry on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
  })
})
