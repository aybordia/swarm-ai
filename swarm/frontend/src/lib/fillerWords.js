// Tiny pure helper — counts filler words in a transcript segment. Used only to
// populate the communication profile's filler_word_rate metric (a neutral
// count, never surfaced as "bad" — see backend/lib/observationRules.js).
const FILLER_PATTERN = /\b(um+|uh+|like|you know|sort of|kind of|i mean)\b/gi;

export function countFillerWords(text) {
  if (!text) return 0;
  const matches = text.match(FILLER_PATTERN);
  return matches ? matches.length : 0;
}
