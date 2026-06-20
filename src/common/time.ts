import { DateTime } from 'luxon';

const SHIFT_START_HOUR = 23;
const SHIFT_END_HOUR = 7;

/**
 * Returns the morning date (YYYY-MM-DD) on which the shift containing `timestamp` ends.
 * Shift window is [hotel-local 23:00, next-day 07:00).
 * Events between 00:00 and 07:00 belong to the morning that same calendar day ends on.
 * Events at or after 23:00 belong to the next calendar day's morning.
 * Anything in between (07:00–22:59) is daytime; we still bucket it to the next morning
 * so callers passing daytime events don't silently lose them — but they will be
 * filtered out at the classify step.
 */
export function shiftDateFor(timestamp: string, timezone: string): string {
  const dt = DateTime.fromISO(timestamp, { setZone: true });
  if (!dt.isValid) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }
  const local = dt.setZone(timezone);
  if (local.hour >= SHIFT_START_HOUR) {
    return local.plus({ days: 1 }).toFormat('yyyy-LL-dd');
  }
  return local.toFormat('yyyy-LL-dd');
}

export function shiftWindow(
  targetMorning: string,
  timezone: string,
): { from: string; to: string } {
  const morning = DateTime.fromISO(targetMorning, { zone: timezone });
  if (!morning.isValid) {
    throw new Error(`Invalid targetMorning: ${targetMorning}`);
  }
  const from = morning
    .minus({ days: 1 })
    .set({ hour: SHIFT_START_HOUR, minute: 0, second: 0, millisecond: 0 });
  const to = morning.set({
    hour: SHIFT_END_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  return { from: from.toISO()!, to: to.toISO()! };
}

export function isInShift(
  timestamp: string,
  targetMorning: string,
  timezone: string,
): boolean {
  return shiftDateFor(timestamp, timezone) === targetMorning;
}
