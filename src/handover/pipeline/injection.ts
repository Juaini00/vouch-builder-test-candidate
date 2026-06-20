const INJECTION_PATTERNS: RegExp[] = [
  /\bignore (all|previous|other) (instructions|items|messages)\b/i,
  /\bsystem (note|prompt|message) to\b/i,
  /\b(disregard|override) (the|all|previous)\b/i,
  /\b(you are|act as)\b.*\b(assistant|model|ai)\b/i,
  /\b(report .* as all clear|mark .* approved|add .* credit)\b/i,
  /\bprompt\s*injection\b/i,
];

/** Returns true if `text` looks like it might be trying to instruct an LLM. */
export function looksLikeInjection(text: string): boolean {
  if (!text) return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}
