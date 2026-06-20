import { IncidentThread } from '../../common/types';

/**
 * Grounding check focuses on values that are hallucination-prone:
 *  - Numbers (room numbers, counts, dates)
 *  - Currency amounts (SGD 100, $50, etc.)
 *  - Proper nouns (capitalized words/phrases — usually guest names)
 * Common English vocabulary is implicitly trusted. The threat surface is
 * the LLM inventing a specific value, not the LLM phrasing a verb.
 */

const NUMBER_RE = /\b\d{2,}\b/g; // ignore 1-digit numbers; not informative
const CURRENCY_RE = /\b(?:SGD|USD|EUR|GBP|MYR|RM|IDR|RP)\s*\d[\d.,]*\b/gi;
const PROPER_RE =
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g; // up to 4-word capitalized sequence

// Sentence-starting verbs, common operational nouns, and generic
// connector words that happen to be capitalised but carry no factual
// risk if the LLM uses them.
const SAFE_PROPER_TOKENS = new Set([
  // Days / months
  'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
  'January','February','March','April','May','June','July','August','September','October','November','December',
  // Generic nouns / acronyms
  'Room','Rooms','Guest','Guests','SGD','USD','EUR','GBP','MYR','RM','IDR','Rp',
  'OOO','OTA','VIP','ID','PM','AM','FYI','OK','TBD','ASAP',
  'Front','Desk','Night','Morning','Evening','Afternoon','Manager','Reception','Hotel','Building',
  'Immigration','Housekeeping','Maintenance','Finance','Vendor','Floor','Corridor','Lobby','Lift',
  'Card','Cash','Deposit','Charge','Refund','Invoice','Payment','Booking','Reservation',
  'Status','Update','Issue','Open','Closed','Pending','Resolved','Unresolved','Pass','Fail',
  // Sentence-initial verbs / hedges the LLM uses
  'This','That','These','Those','It','There','Here','As','Now','Today','Tonight','Yesterday','Tomorrow',
  'Please','Note','However','Also','Although','Because','Since','While','When','Where','Why','How','What',
  'Confirm','Check','Ensure','Resolve','Settle','Send','Submit','Call','Contact','Schedule','Hold','Charge',
  'Verify','Review','Approve','Reject','Investigate','Escalate','Flag','Follow','Followup','Continue','Stop','Start',
  'Outstanding','Action','Required','Needed','Recommended','Suggested','Awaiting','Before','After','During','Until',
  'Cracked','Damaged','Broken','Leaking','Unwell','Offline','Online','Out','In','New','Old','Late','Early',
]);

function vocabularyFor(thread: IncidentThread): {
  numbers: Set<string>;
  currencies: Set<string>;
  properTokens: Set<string>;
  haystack: string;
} {
  const numbers = new Set<string>();
  const currencies = new Set<string>();
  const properTokens = new Set<string>();
  const haystackParts: string[] = [];

  for (const ev of thread.events) {
    haystackParts.push(ev.description);
    haystackParts.push(ev.timestamp); // expose hour/minute digits to the validator
    for (const e of ev.evidence) haystackParts.push(e.quote);
    if (ev.room) haystackParts.push(`Room ${ev.room}`);
    if (ev.guest) haystackParts.push(ev.guest);
  }
  const haystack = haystackParts.join(' \n ');

  for (const m of haystack.match(NUMBER_RE) ?? []) numbers.add(m);
  for (const m of haystack.match(CURRENCY_RE) ?? [])
    currencies.add(m.replace(/\s+/g, ' ').toLowerCase());
  for (const m of haystack.match(PROPER_RE) ?? []) {
    for (const part of m.split(/\s+/)) properTokens.add(part);
  }
  return { numbers, currencies, properTokens, haystack };
}

export interface GroundingResult {
  grounded: boolean;
  ungrounded: string[];
}

export function checkGrounding(
  text: string,
  thread: IncidentThread,
): GroundingResult {
  const vocab = vocabularyFor(thread);
  const ungrounded: string[] = [];

  for (const m of text.match(NUMBER_RE) ?? []) {
    if (!vocab.numbers.has(m)) ungrounded.push(`#${m}`);
  }
  for (const m of text.match(CURRENCY_RE) ?? []) {
    const norm = m.replace(/\s+/g, ' ').toLowerCase();
    if (!vocab.currencies.has(norm)) ungrounded.push(`$${m}`);
  }
  for (const m of text.match(PROPER_RE) ?? []) {
    for (const part of m.split(/\s+/)) {
      if (SAFE_PROPER_TOKENS.has(part)) continue;
      if (vocab.properTokens.has(part)) continue;
      // Single-letter or 2-letter all-caps acronyms — let them through
      if (part.length <= 2) continue;
      ungrounded.push(part);
    }
  }
  return { grounded: ungrounded.length === 0, ungrounded };
}

export function templatedBody(thread: IncidentThread): string {
  const lines = thread.events.slice(0, 3).map((e) => {
    const date = e.timestamp.slice(0, 10);
    return `[${date}] ${e.description}`;
  });
  return lines.join(' ');
}

export function templatedTitle(thread: IncidentThread): string {
  const subject = thread.topic.replace(/_/g, ' ');
  const room = thread.room ? ` (room ${thread.room})` : '';
  const statusTag =
    thread.status === 'still_open'
      ? 'still open'
      : thread.status === 'newly_resolved'
        ? 'resolved overnight'
        : thread.status === 'new_tonight'
          ? 'new tonight'
          : 'needs review';
  return `${subject}${room} — ${statusTag}`.slice(0, 80);
}
