/**
 * Transition-safe resolution of a local wall-clock value to exact epoch
 * instants in an IANA time zone. The resolver samples the zone's UTC offsets
 * around the UTC-shaped guess, projects each offset back to a candidate
 * instant, and keeps the candidates whose `Intl` projection reproduces the
 * requested wall clock exactly. A fall-back overlap yields two instants (the
 * earliest is the convention's first occurrence); a spring-forward gap over
 * the requested wall clock yields none. All instants stay inside the
 * four-digit-year representable range; a match dropped only by that range is
 * reported through {@link ZonedResolution.outOfRange} instead.
 *
 * This is the shared primitive behind schedule rule targets and token-usage
 * day windows; both consumers layer their own error identities on top.
 *
 * @module @deepseek-ai/dsh-zoned-time
 */

/** Wall-clock fields identifying one local instant; omitted time fields default to zero. */
export interface ZonedWallClock {
  /** Calendar year (full form, e.g. `2026`). */
  readonly year: number
  /** 1-based calendar month. */
  readonly month: number
  /** Calendar day. */
  readonly day: number
  /** Hour 0-23; defaults to 0. */
  readonly hour?: number
  /** Minute 0-59; defaults to 0. */
  readonly minute?: number
  /** Second 0-59; defaults to 0. */
  readonly second?: number
  /** Millisecond 0-999; defaults to 0. */
  readonly millisecond?: number
}

/** Exact epoch instants reproducing the requested wall clock, plus range-rejection facts. */
export interface ZonedResolution {
  /**
   * Matching epoch milliseconds, ascending. Empty when no instant projects
   * back onto the requested wall clock — a transition gap swallowed it, the
   * calendar value is not real, or only out-of-range matches existed.
   */
  readonly instants: readonly number[]
  /** At least one matching instant existed but fell outside the four-digit-year bounds. */
  readonly outOfRange: boolean
}

/** Four-digit-year representable bounds, shared with every sampling candidate. */
const MIN_RANGE_MS = Date.parse('0001-01-01T00:00:00.000Z')
const MAX_RANGE_MS = Date.parse('9999-12-31T23:59:59.999Z')

/** The `timeZoneName` part shape emitted for the `longOffset` option. */
const OFFSET_NAME = /^GMT(?:(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?$/

/**
 * Build the fixed-profile formatter used for every offset sample and
 * projection check: ISO calendar, Latin digits, 24-hour clock, millisecond
 * precision, and a parseable long-offset zone name.
 * @param timeZone - UTC or an IANA Area/Location name.
 * @returns the configured formatter.
 */
function buildFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
}

/**
 * Read the UTC offset in effect at one instant, in milliseconds.
 * @param formatter - formatter built for the target zone.
 * @param epoch - instant to sample.
 * @returns the offset, east positive.
 * @throws when the platform does not expose the requested `longOffset` part.
 */
function offsetAt(formatter: Intl.DateTimeFormat, epoch: number): number {
  const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]))
  /* v8 ignore next -- a formatter configured with longOffset always emits a GMT offset part. */
  const match = typeof parts['timeZoneName'] === 'string' ? OFFSET_NAME.exec(parts['timeZoneName']) : null
  const groups = match?.groups
  /* v8 ignore next -- a formatter configured with longOffset always emits a GMT offset part. */
  if (match === null || groups === undefined) {
    throw new Error(`time zone ${JSON.stringify(formatter.resolvedOptions().timeZone)} did not expose a usable UTC offset`)
  }
  /* v8 ignore next -- some Intl builds spell UTC as bare GMT instead of GMT+00:00. */
  if (groups['sign'] === undefined) return 0
  const direction = groups['sign'] === '-' ? -1 : 1
  const hour = Number(groups['hour'])
  const minute = Number(groups['minute'])
  const second = Number(groups['second'] ?? '0')
  return direction * (hour * 3600 + minute * 60 + second) * 1_000
}

/**
 * Convert wall-clock fields to the UTC-shaped epoch guess without normalizing
 * away the requested values. `setUTCFullYear` keeps years 0-99 literal, which
 * the two-digit-year mapping of `Date.UTC` would corrupt.
 * @param wallClock - the requested local fields.
 * @returns the UTC-shaped epoch used as the projection center.
 */
function utcShapedEpoch(wallClock: ZonedWallClock): number {
  const value = new Date(0)
  value.setUTCHours(0, 0, 0, 0)
  value.setUTCFullYear(wallClock.year, wallClock.month - 1, wallClock.day)
  value.setUTCHours(
    wallClock.hour ?? 0,
    wallClock.minute ?? 0,
    wallClock.second ?? 0,
    wallClock.millisecond ?? 0,
  )
  return value.getTime()
}

/**
 * Resolve every exact epoch instant whose projection onto `timeZone` equals
 * the requested wall clock. Offsets are sampled at ±48h around the UTC-shaped
 * guess so any real transition adjacent to the value contributes a candidate;
 * each in-range candidate is verified field by field against the request.
 *
 * Callers pass validated integer calendar fields; a non-real value (such as
 * February 30) or a non-finite one simply produces no match. An unsupported
 * time zone fails loud from `Intl` itself rather than degrading to an empty
 * result.
 * @param timeZone - UTC or an IANA Area/Location name bounding the wall clock.
 * @param wallClock - the requested local fields; omitted time fields default to zero.
 * @returns the ascending exact instants plus the four-digit-year rejection flag.
 * @throws when `timeZone` is not a supported zone or the platform exposes no usable offset.
 */
export function resolveZonedWallClock(timeZone: string, wallClock: ZonedWallClock): ZonedResolution {
  const formatter = buildFormatter(timeZone)
  const base = utcShapedEpoch(wallClock)
  if (!Number.isFinite(base)) return { instants: [], outOfRange: false }
  const offsets = new Set<number>()
  for (const delta of [-172_800_000, -86_400_000, 0, 86_400_000, 172_800_000]) {
    const sample = Math.min(MAX_RANGE_MS, Math.max(MIN_RANGE_MS, base + delta))
    offsets.add(offsetAt(formatter, sample))
  }
  const instants: number[] = []
  let outOfRange = false
  for (const offset of offsets) {
    const candidate = base - offset
    if (candidate < MIN_RANGE_MS || candidate > MAX_RANGE_MS) {
      outOfRange = true
      continue
    }
    const projected = Object.fromEntries(
      formatter.formatToParts(candidate).map(part => [part.type, part.value]),
    )
    if (Number(projected['year']) === wallClock.year
      && Number(projected['month']) === wallClock.month
      && Number(projected['day']) === wallClock.day
      && Number(projected['hour']) === (wallClock.hour ?? 0)
      && Number(projected['minute']) === (wallClock.minute ?? 0)
      && Number(projected['second']) === (wallClock.second ?? 0)
      && Number(projected['fractionalSecond']) === (wallClock.millisecond ?? 0)) {
      instants.push(candidate)
    }
  }
  return { instants: instants.sort((left, right) => left - right), outOfRange }
}
