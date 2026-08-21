import { describe, expect, it } from 'vitest'
import { resolveZonedWallClock } from '../src/index.ts'

describe('resolveZonedWallClock', () => {
  it('resolves a plain UTC midnight to the exact epoch', () => {
    const resolution = resolveZonedWallClock('UTC', { year: 2026, month: 8, day: 10 })
    expect(resolution.instants).toEqual([Date.UTC(2026, 7, 10)])
    expect(resolution.outOfRange).toBe(false)
  })

  it('defaults omitted time fields to zero and honors explicit milliseconds', () => {
    expect(resolveZonedWallClock('UTC', { year: 2026, month: 1, day: 2 }).instants)
      .toEqual([Date.UTC(2026, 0, 2)])
    expect(
      resolveZonedWallClock('UTC', {
        year: 2026,
        month: 1,
        day: 2,
        hour: 3,
        minute: 4,
        second: 5,
        millisecond: 500,
      }).instants,
    ).toEqual([Date.UTC(2026, 0, 2, 3, 4, 5, 500)])
  })

  it('resolves local midnight in a fixed positive-offset zone', () => {
    // Asia/Shanghai is UTC+8 all year: local 2026-08-10T00:00 is 2026-08-09T16:00Z.
    const resolution = resolveZonedWallClock('Asia/Shanghai', { year: 2026, month: 8, day: 10 })
    expect(resolution.instants).toEqual([Date.UTC(2026, 7, 9, 16)])
  })

  it('returns no instant for a spring-forward gap wall clock', () => {
    // US DST 2026 starts March 8 at 02:00 local; 02:30 does not exist.
    const resolution = resolveZonedWallClock('America/New_York', {
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
    })
    expect(resolution.instants).toEqual([])
    expect(resolution.outOfRange).toBe(false)
  })

  it('returns both fall-back instants in ascending order for an overlapped wall clock', () => {
    // US DST 2026 ends November 1 at 02:00 local; 01:30 occurs in EDT and again in EST.
    const resolution = resolveZonedWallClock('America/New_York', {
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
    })
    expect(resolution.instants).toEqual([
      Date.UTC(2026, 10, 1, 5, 30), // EDT (UTC-4): the first occurrence.
      Date.UTC(2026, 10, 1, 6, 30), // EST (UTC-5): the repeated occurrence.
    ])
  })

  it('reports outOfRange instead of instants beyond the four-digit-year bounds', () => {
    // Etc/GMT-14 is fixed UTC+14: local year-1 midnight projects before year 1 UTC.
    const tooEarly = resolveZonedWallClock('Etc/GMT-14', { year: 1, month: 1, day: 1 })
    expect(tooEarly.instants).toEqual([])
    expect(tooEarly.outOfRange).toBe(true)

    // Etc/GMT+11 is fixed UTC-11: the last representable local millisecond projects into year 10000.
    const tooLate = resolveZonedWallClock('Etc/GMT+11', {
      year: 9999,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999,
    })
    expect(tooLate.instants).toEqual([])
    expect(tooLate.outOfRange).toBe(true)
  })

  it('keeps an in-range boundary match next to the out-of-range rejection flag', () => {
    // The same zone resolves one millisecond earlier without touching the bounds.
    const edge = resolveZonedWallClock('Etc/GMT+11', {
      year: 9999,
      month: 12,
      day: 31,
      hour: 12,
      minute: 59,
      second: 59,
      millisecond: 999,
    })
    expect(edge.instants).toEqual([Date.UTC(9999, 11, 31, 23, 59, 59, 999)])
    expect(edge.outOfRange).toBe(false)
  })

  it('produces no match for a non-real calendar date', () => {
    // February 30 normalizes the projection center to March 2; no instant reads back as Feb 30.
    const resolution = resolveZonedWallClock('UTC', { year: 2026, month: 2, day: 30 })
    expect(resolution.instants).toEqual([])
    expect(resolution.outOfRange).toBe(false)
  })

  it('produces no match for non-finite fields instead of failing inside Intl', () => {
    const resolution = resolveZonedWallClock('UTC', { year: Number.NaN, month: 1, day: 1 })
    expect(resolution.instants).toEqual([])
    expect(resolution.outOfRange).toBe(false)
  })

  it('fails loud on an unsupported time zone', () => {
    expect(() => resolveZonedWallClock('Not/AZone', { year: 2026, month: 1, day: 1 }))
      .toThrow(RangeError)
  })
})
