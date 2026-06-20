import {
  CanonicalEvent,
  Contradiction,
  IncidentThread,
  ThreadStatus,
} from '../../common/types';

interface TopicRule {
  topic: string;
  keywords: RegExp;
}

// Order matters: more-specific topics first. The first matching rule wins.
const TOPIC_RULES: TopicRule[] = [
  { topic: 'safe', keywords: /\b(safe|保险箱)\b/i },
  { topic: 'damage', keywords: /\b(damage|cracked|broken|housekeeping found)\b/i },
  { topic: 'medical', keywords: /\b(unwell|ambulance|medication|medical)\b/i },
  { topic: 'check_in_issue', keywords: /\b(booking name|passport.*match|verified booking|name.*not match)\b/i },
  { topic: 'compliance_scanner', keywords: /\b(immigration\s+(scanner|scanning|reporting)|passport.*scanner|passport.*scanned|passport.*reporting|scanner.*offline|scanner.*online|backlog.*passport|immigration system|护照.*扫|扫描.*护照)\b/i },
  { topic: 'aircon', keywords: /\b(aircon|a\/?c|air[- ]conditioner|compressor|cooling|空调)\b/i },
  { topic: 'leak', keywords: /\b(leak|drip|wet[- ]floor|mopped|carpet soak|漏水|渗水|water.*corridor|water.*floor)\b/i },
  { topic: 'deposit', keywords: /\b(deposit|sgd ?100|card declined|prepaid|押金)\b/i },
  { topic: 'no_show', keywords: /\b(no[- ]show|did not arrive|cancellation|cancelled|no-show|未到|no[- ]show charge)\b/i },
  { topic: 'noise', keywords: /\b(noise|loud|complaint about room|噪音)\b/i },
  { topic: 'wifi', keywords: /\bwi[- ]?fi\b/i },
  { topic: 'parcel', keywords: /\b(parcel|package|holding .* desk)\b/i },
  { topic: 'walk_in', keywords: /\b(walk[- ]in)\b/i },
  { topic: 'occupancy_mismatch', keywords: /\b(in[- ]house|door ajar|nobody|not slept|room empty|never got recorded)\b/i },
  { topic: 'breakfast', keywords: /\b(breakfast|kitchen|6am opening)\b/i },
  { topic: 'early_checkout', keywords: /\b(early[- ]checkout|leaving \d|deposit refund|invoice)\b/i },
];

function detectTopic(event: CanonicalEvent): string {
  const haystack = `${event.type} ${event.description}`;
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.test(haystack)) return rule.topic;
  }
  return event.type;
}

function threadKey(topic: string, room: string | null): string {
  return `${topic}::${room ?? 'no_room'}`;
}

export function buildThreads(
  events: CanonicalEvent[],
  targetMorning: string,
): IncidentThread[] {
  const byKey = new Map<string, CanonicalEvent[]>();
  for (const e of events) {
    const topic = detectTopic(e);
    const key = threadKey(topic, e.room);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }

  const initial: IncidentThread[] = [];
  for (const [key, evs] of byKey.entries()) {
    const sorted = [...evs].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : 1,
    );
    const [topic, room] = key.split('::');
    initial.push({
      threadId: `thr_${topic}_${room === 'no_room' ? 'any' : room}`,
      topic,
      room: room === 'no_room' ? null : room,
      firstSeen: sorted[0].timestamp,
      lastUpdate: sorted[sorted.length - 1].timestamp,
      events: sorted,
      status: 'unknown',
      contradictions: [],
    });
  }

  // Post-merge: a "room-less" thread (e.g. leak in a corridor) whose events
  // explicitly mention a room number that another same-topic thread is keyed
  // on should fold into that room-bearing thread.
  const merged = mergeRoomlessIntoRoomBearing(initial);

  // Finalise status + contradictions on the merged set.
  return merged.map((t) => ({
    ...t,
    status: deriveStatus(t.events, targetMorning),
    contradictions: detectContradictions(t.events),
    firstSeen: t.events[0].timestamp,
    lastUpdate: t.events[t.events.length - 1].timestamp,
  }));
}

function mergeRoomlessIntoRoomBearing(
  threads: IncidentThread[],
): IncidentThread[] {
  const byTopic = new Map<string, IncidentThread[]>();
  for (const t of threads) {
    const list = byTopic.get(t.topic) ?? [];
    list.push(t);
    byTopic.set(t.topic, list);
  }

  const out: IncidentThread[] = [];
  for (const [, group] of byTopic.entries()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const roomless = group.filter((g) => g.room === null);
    const roomed = group.filter((g) => g.room !== null);
    if (roomless.length === 0 || roomed.length === 0) {
      out.push(...group);
      continue;
    }

    // Try to fold each roomless thread into a roomed thread that mentions that room.
    const consumed = new Set<string>();
    for (const rl of roomless) {
      const haystack = rl.events
        .map((e) => `${e.description} ${e.evidence.map((x) => x.quote).join(' ')}`)
        .join(' ');
      let target: IncidentThread | undefined;
      for (const rb of roomed) {
        const re = new RegExp(`\\b${rb.room}\\b`);
        if (re.test(haystack)) {
          target = rb;
          break;
        }
      }
      if (target) {
        target.events = [...target.events, ...rl.events].sort((a, b) =>
          a.timestamp < b.timestamp ? -1 : 1,
        );
        consumed.add(rl.threadId);
      }
    }
    out.push(...roomed);
    out.push(...roomless.filter((rl) => !consumed.has(rl.threadId)));
  }
  return out;
}

function deriveStatus(
  events: CanonicalEvent[],
  targetMorning: string,
): ThreadStatus {
  const inShift = events.filter((e) => e.shiftDate === targetMorning);
  const priorShift = events.filter(
    (e) => e.shiftDate < targetMorning,
  );

  const priorUnresolved = priorShift.some(
    (e) => e.status === 'unresolved' || e.status === 'pending',
  );

  // No events in the target shift — carry forward only if the LATEST event
  // (the current state of the issue) is still open. A thread resolved earlier
  // in the week shouldn't reappear days later.
  if (inShift.length === 0) {
    const last = events[events.length - 1];
    if (last.status === 'unresolved' || last.status === 'pending') {
      return 'still_open';
    }
    return 'unknown';
  }

  // Target shift only — brand new.
  if (priorShift.length === 0) {
    const allResolved = inShift.every((e) => e.status === 'resolved');
    // Even brand-new fully-resolved threads can be useful FYI; mark as new_tonight.
    return allResolved && inShift.length > 1 ? 'newly_resolved' : 'new_tonight';
  }

  const inShiftResolved = inShift.some((e) => e.status === 'resolved');
  const inShiftUnresolved = inShift.some(
    (e) => e.status === 'unresolved' || e.status === 'pending',
  );

  if (priorUnresolved && inShiftResolved && !inShiftUnresolved)
    return 'newly_resolved';
  if (priorUnresolved && inShiftUnresolved) return 'still_open';
  if (priorUnresolved && !inShiftResolved) return 'still_open';
  if (inShiftResolved && !inShiftUnresolved) return 'newly_resolved';
  return 'unknown';
}

function detectContradictions(events: CanonicalEvent[]): Contradiction[] {
  const contradictions: Contradiction[] = [];
  // Status conflict: same thread has both 'resolved' and a later 'pending'/'unresolved' that disputes it
  const hasResolved = events.some((e) => e.status === 'resolved');
  const hasLaterDispute = events.some(
    (e, i) =>
      i > 0 &&
      (e.status === 'pending' || e.status === 'unresolved') &&
      /\b(dispute|disputed|disputes|reverse|incorrect|wrong)\b/i.test(
        e.description,
      ),
  );
  if (hasResolved && hasLaterDispute) {
    contradictions.push({
      kind: 'status_conflict',
      description:
        'Earlier event in this thread was marked resolved, but a later event disputes that resolution.',
      evidence: events.flatMap((e) => e.evidence),
    });
  }
  // System-vs-observation: in-house system status vs prose observation of empty room
  const systemSaysInHouse = events.some((e) =>
    /\b(in[- ]house|in house|system shows)\b/i.test(e.description),
  );
  const observedEmpty = events.some((e) =>
    /\b(door ajar|bed.*not slept|nobody|room empty|luggage anywhere)\b/i.test(
      e.description,
    ),
  );
  if (systemSaysInHouse && observedEmpty) {
    contradictions.push({
      kind: 'system_vs_observation',
      description:
        'Front-desk system shows the room as in-house, but overnight observation suggests the room is empty.',
      evidence: events.flatMap((e) => e.evidence),
    });
  }
  return contradictions;
}
