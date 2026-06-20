import { CanonicalEvent } from '../../common/types';
import { shiftDateFor } from '../../common/time';
import { RawEvent } from '../dto/input.dto';
import { looksLikeInjection } from './injection';

export function ingestStructured(
  events: RawEvent[],
  timezone: string,
): CanonicalEvent[] {
  return events.map((e) => ({
    id: e.id,
    source: 'structured',
    timestamp: e.timestamp,
    shiftDate: shiftDateFor(e.timestamp, timezone),
    type: e.type,
    room: e.room,
    guest: e.guest,
    description: e.description,
    status: e.status,
    evidence: [
      { sourceRef: `events.json#${e.id}`, quote: e.description },
    ],
    suspectedInjection: looksLikeInjection(e.description),
  }));
}
