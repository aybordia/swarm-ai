// Neutral, descriptive summaries of client-derived tracking signals.
// Input: [{ timestamp, signal_type, value }] — derived numbers only, never video.
// Output: plain-language observations. Deliberately non-evaluative: describes
// change over time, never "good/bad", never "normal/abnormal". All phrasing
// is delegated to formatObservation() — this module only does the numeric
// analysis (which segment moved most) and hands off the sentence itself.

import { formatObservation } from "./observationRules.js";

function stats(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

function thirds(series) {
  const n = series.length;
  return [
    series.slice(0, Math.floor(n / 3)),
    series.slice(Math.floor(n / 3), Math.floor((2 * n) / 3)),
    series.slice(Math.floor((2 * n) / 3)),
  ];
}

const SEGMENT_NAMES = ["the first part", "the middle", "the final part"];

// Describes how much a signal moved around, and when — nothing more.
function describeMovement(series, { noun, movedVerb = "shifted" }) {
  if (series.length < 10) return `Not enough ${noun} data was collected to describe a trend.`;

  const values = series.map(p => p.value);
  const overall = stats(values);
  const segs = thirds(series).map(seg => stats(seg.map(p => p.value)));

  // Which third had the most variation, relative to the whole session
  const sds = segs.map(s => s?.sd ?? 0);
  const maxIdx = sds.indexOf(Math.max(...sds));
  const minIdx = sds.indexOf(Math.min(...sds));
  const spread = Math.max(...sds) - Math.min(...sds);

  if (overall.sd < 0.02 || overall.sd < Math.abs(overall.mean) * 0.05) {
    return formatObservation({ kind: "variance", metric: noun, steady: true });
  }
  if (spread > overall.sd * 0.5) {
    return formatObservation({
      kind: "variance", metric: noun, movedVerb,
      maxSegment: SEGMENT_NAMES[maxIdx], minSegment: SEGMENT_NAMES[minIdx],
    });
  }
  return formatObservation({ kind: "variance", metric: noun, movedVerb, even: true });
}

// Optionally relate the most-varied window to what was being asked at the time
function contextForWindow(series, transcript) {
  if (!series.length || !transcript?.length) return "";
  const segs = thirds(series);
  const sds = segs.map(seg => stats(seg.map(p => p.value))?.sd ?? 0);
  const maxIdx = sds.indexOf(Math.max(...sds));
  const seg = segs[maxIdx];
  if (!seg.length) return "";
  const t0 = seg[0].timestamp, t1 = seg[seg.length - 1].timestamp;
  const during = transcript.find(t =>
    t.timestamp >= t0 && t.timestamp <= t1 && t.speaker !== "You" && t.speaker !== "User");
  if (during?.text) {
    return ` That window overlapped with the question "${during.text.slice(0, 80)}${during.text.length > 80 ? "…" : ""}".`;
  }
  return "";
}

const SIGNAL_CONFIG = {
  posture: { noun: "sitting position", movedVerb: "shifted" },
  head_tilt: { noun: "head angle", movedVerb: "varied" },
  mouth_movement: { noun: "speaking movement", movedVerb: "varied" },
};

export function summarizeSignals(signalData = [], transcript = []) {
  const summary = {};
  if (!Array.isArray(signalData) || !signalData.length) return summary;

  for (const [type, cfg] of Object.entries(SIGNAL_CONFIG)) {
    const series = signalData
      .filter(p => p.signal_type === type && Number.isFinite(p.value))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!series.length) continue;
    summary[type] = describeMovement(series, cfg) + contextForWindow(series, transcript);
  }
  return summary;
}
