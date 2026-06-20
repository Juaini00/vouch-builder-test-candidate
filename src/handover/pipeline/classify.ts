import { Bucket, IncidentThread } from '../../common/types';

const ON_FIRE_TOPICS = new Set([
  'compliance_scanner',
  'leak',
  'safe',
  'medical',
  'damage',
]);

const FYI_TOPICS = new Set(['parcel', 'walk_in']);

/** Decide which bucket a thread belongs in for the morning handover. */
export function classify(thread: IncidentThread): Bucket {
  // Anything suspected of injection or with contradictions → flag
  if (
    thread.contradictions.length > 0 ||
    thread.events.some((e) => e.suspectedInjection)
  ) {
    return 'flag';
  }

  // Newly resolved threads with no follow-up → fyi
  if (thread.status === 'newly_resolved') return 'fyi';

  // Still open or new tonight with an "on fire" topic
  if (
    (thread.status === 'still_open' || thread.status === 'new_tonight') &&
    ON_FIRE_TOPICS.has(thread.topic)
  ) {
    return 'on_fire';
  }

  // Deposit issues that touch a guest checking out tomorrow → on_fire
  if (
    thread.topic === 'deposit' &&
    thread.events.some((e) =>
      /\bcheck(?:s|ing)?\s*out\b/i.test(e.description),
    )
  ) {
    return 'on_fire';
  }

  if (FYI_TOPICS.has(thread.topic) && thread.status !== 'still_open')
    return 'fyi';

  if (thread.status === 'still_open' || thread.status === 'new_tonight') {
    // Anything with status=pending in events → pending bucket
    const hasPending = thread.events.some((e) => e.status === 'pending');
    return hasPending ? 'pending' : 'pending';
  }

  return 'fyi';
}
