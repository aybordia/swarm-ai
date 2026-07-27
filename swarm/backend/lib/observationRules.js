// Single source of truth for the product's core non-negotiable: never coach
// masking. Every prompt that touches delivery/tracked-signal content must
// interpolate TRACKING_SYSTEM_RULES rather than hand-rolling its own bullet —
// this constant is a strict superset of every rule previously duplicated
// (with wording drift) across judgeOrchestrator.js, debrief.js, and
// exampleAnswer.js.
export const TRACKING_SYSTEM_RULES = `- NEVER comment on, evaluate, or reference: eye contact, pauses, thinking time, pacing, speech rate, tone of voice, speech patterns, how they talk, body language, posture, movement, fidgeting, or stimming. Long pauses and self-regulatory movement are normal — never reference them, positively or negatively.
- NEVER suggest the candidate act more "normal", mask, hide their personality, suppress movement or stimming, change their voice, force eye contact, seem more confident, be more "natural", or perform differently as a person. Difference is not deficit.
- NEVER frame a tracked signal as good/bad, normal/abnormal, or score it against any baseline.
- Any statement about a tracked signal must be a neutral, measured, context-linked observation of what happened (e.g. "your pace increased X% during Y compared to Z") — never an instruction, suggestion, or judgment. State the fact and stop; let the person decide what, if anything, to do with it.
- Coaching the CONTENT and STRUCTURE of what was said (facts, organization, specificity, relevance) is allowed and encouraged. Coaching HOW it was delivered physically or vocally is never allowed.`;

function round(n, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function pctChange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return round(((a - b) / Math.abs(b)) * 100, 0);
}

// Pure, deterministic, no LLM call — same design family as
// signalSummary.js::describeMovement() and debrief.js::describePacing().
// A fixed set of neutral sentence templates keyed on metric/direction/
// magnitude; no branch here is capable of emitting good/bad/normal/abnormal
// language or an instruction. Enforcement by construction, not by
// prompt-following. All numeric/tracked-signal-derived output should route
// through this rather than being generated free-form by an LLM.
//
//   kind: "context_delta"  — "Your X increased 28% during A compared to B (182 wpm vs 142 wpm)."
//   kind: "context_compare" — "Your average X A was 6.3s, compared to 2.1s B."
//   kind: "trend"           — "X has decreased from 6.1s to 4.2s over 8 sessions."
export function formatObservation(input = {}) {
  const { kind, metric, unit = "" } = input;
  const u = unit ? unit : "";
  const fmt = (n) => `${round(n)}${u}`;

  switch (kind) {
    case "context_delta": {
      const { valueA, contextA, valueB, contextB } = input;
      const delta = pctChange(valueA, valueB);
      if (delta === null || delta === 0) return null;
      const direction = delta > 0 ? "increased" : "decreased";
      return `Your ${metric} ${direction} about ${Math.abs(delta)}% during ${contextA} compared to ${contextB} (${fmt(valueA)} vs ${fmt(valueB)}).`;
    }
    case "context_compare": {
      const { valueA, contextA, valueB, contextB } = input;
      if (!Number.isFinite(valueA) || !Number.isFinite(valueB)) return null;
      return `Your average ${metric} ${contextA} was ${fmt(valueA)}, compared to ${fmt(valueB)} ${contextB}.`;
    }
    case "trend": {
      const { from, to, sessionCount } = input;
      if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
      const direction = to < from ? "decreased" : to > from ? "increased" : "stayed steady";
      const range = direction === "stayed steady" ? `around ${fmt(to)}` : `from ${fmt(from)} to ${fmt(to)}`;
      return `${metric} has ${direction} ${range}${sessionCount ? ` over ${sessionCount} sessions` : ""}.`;
    }
    default:
      return null;
  }
}
