// Persistent, cross-session communication profile. Distinct from prefsStore.js
// (self-set ASD profile + inert adaptive-rating prefs): this store accumulates
// DERIVED METRICS ONLY from real sessions (never raw video, never audio unless
// opted in) and is the data source for the Progress view + the branching
// interviewer's per-user thresholds.
//
// Mirrors sessionStore.js's dual Mongo/file pattern (not prefsStore.js's
// file-only pattern) — this is core cross-session product value and
// shouldn't silently vanish on an ephemeral prod filesystem.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSessions } from "./sessionStore.js";

// ── MongoDB (production) ─────────────────────────────────────────
let client = null;
let db = null;
let dbFailed = false;

async function getDB() {
  if (db) return db;
  if (dbFailed) return null;
  if (!process.env.MONGODB_URI) return null;
  try {
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db("swarm");
    return db;
  } catch (e) {
    dbFailed = true;
    console.error("[communicationProfileStore] MongoDB connection failed, falling back to file storage:", e.message);
    return null;
  }
}

// ── File storage fallback (local dev) ───────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/communicationProfiles");

function profileFile(userId) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}
function fileRead(userId) {
  const f = profileFile(userId);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}
function fileWrite(userId, profile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(profileFile(userId), JSON.stringify(profile, null, 2), "utf8");
}
function fileDelete(userId) {
  const f = profileFile(userId);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ── Schema ───────────────────────────────────────────────────────
const METRIC_KEYS = [
  "avg_speaking_pace_wpm",
  "avg_response_latency_sec",
  "filler_word_rate",
  "answer_length_avg_sec",
  "interruption_count",
  "answer_structure_score",
];

function emptyMetric() {
  return { current: null, history: [] };
}

function defaultProfile(userId) {
  return {
    user_id: userId,
    sessions_completed: 0,
    metrics: Object.fromEntries(METRIC_KEYS.map(k => [k, emptyMetric()])),
    context_deltas: {
      technical_vs_behavioral: { pace_delta_pct: null, latency_delta_sec: null },
    },
    user_preferences_learned: {
      prefers_longer_thinking_time: false,
      responds_better_to: null,
      struggles_after_n_followups: null,
    },
    // Fields a manual edit has touched — the aggregator never overwrites these again.
    preferences_locked: {},
    active_focus_area: null,   // user-confirmed only (Feature 2: "AI proposes, user picks")
    proposed_focus_area: null, // AI-proposed, awaiting confirmation
    mastered_areas: [],
    // Internal rolling samples used only to derive user_preferences_learned —
    // not part of the user-facing/editable schema.
    _inference: { extendTimeUsage: [], struggleFollowupSamples: [] },
    updatedAt: 0,
  };
}

function mergeWithDefaults(userId, stored) {
  const d = defaultProfile(userId);
  if (!stored) return d;
  return {
    ...d,
    ...stored,
    metrics: { ...d.metrics, ...(stored.metrics || {}) },
    context_deltas: { ...d.context_deltas, ...(stored.context_deltas || {}) },
    user_preferences_learned: { ...d.user_preferences_learned, ...(stored.user_preferences_learned || {}) },
    preferences_locked: { ...(stored.preferences_locked || {}) },
    mastered_areas: Array.isArray(stored.mastered_areas) ? stored.mastered_areas : [],
    _inference: { ...d._inference, ...(stored._inference || {}) },
  };
}

// ── Public read/write ───────────────────────────────────────────
export async function getCommunicationProfile(userId) {
  const database = await getDB();
  if (database) {
    const doc = await database.collection("communicationProfiles").findOne({ user_id: userId });
    return mergeWithDefaults(userId, doc);
  }
  return mergeWithDefaults(userId, fileRead(userId));
}

export async function saveCommunicationProfile(userId, profile) {
  const toSave = { ...profile, user_id: userId, updatedAt: Date.now() };
  const database = await getDB();
  if (database) {
    await database.collection("communicationProfiles").updateOne(
      { user_id: userId },
      { $set: toSave },
      { upsert: true }
    );
    return toSave;
  }
  fileWrite(userId, toSave);
  return toSave;
}

export async function deleteCommunicationProfile(userId) {
  const database = await getDB();
  if (database) {
    await database.collection("communicationProfiles").deleteOne({ user_id: userId });
  }
  fileDelete(userId);
  return { deleted: true };
}

export async function exportCommunicationProfile(userId) {
  const profile = await getCommunicationProfile(userId);
  const { _inference, ...publicProfile } = profile;
  return publicProfile;
}

// ── Manual preference edits (always overridable, per the no-hidden-profile rule) ──
export async function patchUserPreferences(userId, patch = {}) {
  const profile = await getCommunicationProfile(userId);
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in profile.user_preferences_learned)) continue;
    profile.user_preferences_learned[key] = value;
    profile.preferences_locked[key] = true;
  }
  return saveCommunicationProfile(userId, profile);
}

export async function setActiveFocusArea(userId, area) {
  const profile = await getCommunicationProfile(userId);
  profile.active_focus_area = area || null;
  if (area && profile.proposed_focus_area === area) profile.proposed_focus_area = null;
  return saveCommunicationProfile(userId, profile);
}

// ── Aggregation helpers ─────────────────────────────────────────
function round(n, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
function avg(arr) {
  const vals = arr.filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function median(arr) {
  const vals = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}
function pctDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return round(((a - b) / Math.abs(b)) * 100, 0);
}

function pushMetric(metric, sessionId, value, timestamp, digits = 1) {
  if (!Number.isFinite(value)) return;
  const v = round(value, digits);
  metric.current = v;
  metric.history.push({ session_id: sessionId, value: v, timestamp });
}

function pushQualitativeMetric(metric, sessionId, value, timestamp) {
  if (typeof value !== "string" || !value) return;
  metric.current = value;
  metric.history.push({ session_id: sessionId, value, timestamp });
}

// A turn counts as "struggling" when the answer was short AND markedly slower
// than the user's own running-average latency for that session — a relative,
// self-referential signal, never compared to any external baseline.
function isStruggleTurn(turn, runningAvgLatency) {
  return Number.isFinite(turn.words) && turn.words < 8
    && Number.isFinite(turn.latencySec) && Number.isFinite(runningAvgLatency)
    && turn.latencySec > runningAvgLatency * 1.5;
}

// The smallest within-question follow-up index (0 = initial answer) at which
// this session's answers started struggling, if any.
function extractStruggleFollowupIndex(turnMetrics) {
  const latencies = turnMetrics.map(t => t.latencySec).filter(Number.isFinite);
  const runningAvg = avg(latencies);
  if (runningAvg === null) return null;
  for (const t of turnMetrics) {
    if (Number.isFinite(t.followupIndex) && isStruggleTurn(t, runningAvg)) return t.followupIndex;
  }
  return null;
}

const FOCUS_AREA_METRIC = {
  answer_structure: "answer_structure_score",
  response_latency: "avg_response_latency_sec",
  filler_words: "filler_word_rate",
  answer_length: "answer_length_avg_sec",
};
const LOWER_IS_MASTERY_PROGRESS = new Set(["avg_response_latency_sec", "filler_word_rate"]);

function proposeFocusArea(profile) {
  const m = profile.metrics;
  if (["needs_support", "developing"].includes(m.answer_structure_score.current)
    && !profile.mastered_areas.includes("answer_structure")) return "answer_structure";
  if (Number.isFinite(m.filler_word_rate.current) && m.filler_word_rate.current > 0.08
    && !profile.mastered_areas.includes("filler_words")) return "filler_words";
  if (Number.isFinite(m.avg_response_latency_sec.current) && m.avg_response_latency_sec.current > 6
    && !profile.mastered_areas.includes("response_latency")) return "response_latency";
  if (Number.isFinite(m.answer_length_avg_sec.current) && m.answer_length_avg_sec.current < 20
    && !profile.mastered_areas.includes("answer_length")) return "answer_length";
  const remaining = Object.keys(FOCUS_AREA_METRIC).find(a => !profile.mastered_areas.includes(a));
  return remaining || null;
}

function checkMastery(profile) {
  const area = profile.active_focus_area;
  if (!area || profile.mastered_areas.includes(area)) return;
  const metricKey = FOCUS_AREA_METRIC[area];
  const metric = metricKey && profile.metrics[metricKey];
  if (!metric || metric.history.length < 4) return;

  const last4 = metric.history.slice(-4).map(h => h.value);
  let steady;
  if (metricKey === "answer_structure_score") {
    steady = last4.every(v => v === "strong");
  } else {
    const nums = last4.filter(Number.isFinite);
    if (nums.length < 4) return;
    steady = LOWER_IS_MASTERY_PROGRESS.has(metricKey)
      ? nums.every((v, i) => i === 0 || v <= nums[i - 1])
      : nums.every((v, i) => i === 0 || v >= nums[i - 1]);
    steady = steady && nums[nums.length - 1] !== nums[0];
  }
  if (steady) {
    profile.mastered_areas.push(area);
    profile.active_focus_area = null;
  }
}

// responds_better_to: compares the user's own saved sessions grouped by tone.
// Best-effort — only meaningful once metricsSnapshot has accumulated across
// sessions with different tones; returns unchanged otherwise.
async function inferRespondsBetterTo(userId, profile) {
  if (profile.preferences_locked.responds_better_to) return;
  try {
    const sessions = await getSessions(userId);
    const byTone = {};
    for (const s of sessions) {
      const tone = s.sessionData?.tone;
      const snap = s.metricsSnapshot;
      if (!tone || !snap || !Number.isFinite(snap.struggleRatio)) continue;
      (byTone[tone] ||= []).push(snap.struggleRatio);
    }
    const tones = Object.keys(byTone).filter(t => byTone[t].length >= 2);
    if (tones.length < 2) return;
    let best = tones[0];
    for (const t of tones) {
      if (avg(byTone[t]) < avg(byTone[best])) best = t;
    }
    profile.user_preferences_learned.responds_better_to = best;
  } catch (e) {
    console.error("[communicationProfileStore] responds_better_to inference failed:", e.message);
  }
}

// Lightweight per-session summary stored alongside the session doc
// (sessionStore.js) — powers responds_better_to inference and the Dashboard's
// per-session snapshot (Feature 2), without re-deriving from raw turnMetrics
// every time.
export function computeMetricsSnapshot(turnMetrics = []) {
  const valid = Array.isArray(turnMetrics) ? turnMetrics.filter(t => t && typeof t === "object") : [];
  if (!valid.length) return null;
  const latencies = valid.map(t => t.latencySec).filter(Number.isFinite);
  const runningAvg = avg(latencies);
  const strugglingCount = runningAvg === null ? 0 : valid.filter(t => isStruggleTurn(t, runningAvg)).length;
  const wordsTotal = valid.reduce((a, t) => a + (t.words || 0), 0);
  const fillerTotal = valid.reduce((a, t) => a + (t.fillerCount || 0), 0);
  const avgLatencySec = avg(latencies);
  const avgPaceWpm = avg(valid.map(t => t.paceWpm));
  return {
    avgLatencySec: avgLatencySec !== null ? round(avgLatencySec) : null,
    avgPaceWpm: avgPaceWpm !== null ? round(avgPaceWpm, 0) : null,
    fillerRate: wordsTotal > 0 ? round(fillerTotal / wordsTotal, 3) : null,
    struggleRatio: round(strugglingCount / valid.length, 3),
  };
}

// ── Aggregation entrypoint — called once per saved session ─────────────────
// turnMetrics: [{ questionIndex, questionType, followupIndex, words, latencySec,
//                 answerDurationSec, paceWpm, fillerCount, interruptions }]
export async function updateCommunicationProfileFromSession(userId, {
  sessionId, turnMetrics = [], answerStructureScore = null, extendTimeUsed = false,
} = {}) {
  const profile = await getCommunicationProfile(userId);
  const ts = new Date().toISOString();
  const valid = Array.isArray(turnMetrics) ? turnMetrics.filter(t => t && typeof t === "object") : [];

  if (valid.length) {
    const paceVals = valid.map(t => t.paceWpm).filter(Number.isFinite);
    const latencyVals = valid.map(t => t.latencySec).filter(Number.isFinite);
    const durationVals = valid.map(t => t.answerDurationSec).filter(Number.isFinite);
    const wordsTotal = valid.reduce((a, t) => a + (t.words || 0), 0);
    const fillerTotal = valid.reduce((a, t) => a + (t.fillerCount || 0), 0);
    const interruptionsTotal = valid.reduce((a, t) => a + (t.interruptions || 0), 0);

    pushMetric(profile.metrics.avg_speaking_pace_wpm, sessionId, avg(paceVals), ts, 0);
    pushMetric(profile.metrics.avg_response_latency_sec, sessionId, avg(latencyVals), ts);
    pushMetric(profile.metrics.filler_word_rate, sessionId, wordsTotal > 0 ? fillerTotal / wordsTotal : null, ts, 3);
    pushMetric(profile.metrics.answer_length_avg_sec, sessionId, avg(durationVals), ts);
    pushMetric(profile.metrics.interruption_count, sessionId, interruptionsTotal, ts, 0);

    const tech = valid.filter(t => t.questionType === "technical");
    const behav = valid.filter(t => t.questionType === "behavioral");
    if (tech.length && behav.length) {
      const techPace = avg(tech.map(t => t.paceWpm));
      const behavPace = avg(behav.map(t => t.paceWpm));
      const techLatency = avg(tech.map(t => t.latencySec));
      const behavLatency = avg(behav.map(t => t.latencySec));
      profile.context_deltas.technical_vs_behavioral = {
        pace_delta_pct: pctDelta(techPace, behavPace),
        latency_delta_sec: (Number.isFinite(techLatency) && Number.isFinite(behavLatency))
          ? round(techLatency - behavLatency, 1) : null,
      };
    }

    if (!profile.preferences_locked.struggles_after_n_followups) {
      const sample = extractStruggleFollowupIndex(valid);
      if (sample !== null) {
        profile._inference.struggleFollowupSamples.push(sample);
        profile._inference.struggleFollowupSamples = profile._inference.struggleFollowupSamples.slice(-10);
        const m = median(profile._inference.struggleFollowupSamples);
        if (m !== null) profile.user_preferences_learned.struggles_after_n_followups = Math.max(1, Math.round(m));
      }
    }
  }

  if (!profile.preferences_locked.prefers_longer_thinking_time) {
    profile._inference.extendTimeUsage.push(!!extendTimeUsed);
    profile._inference.extendTimeUsage = profile._inference.extendTimeUsage.slice(-5);
    const uses = profile._inference.extendTimeUsage.filter(Boolean).length;
    profile.user_preferences_learned.prefers_longer_thinking_time = uses >= 3;
  }

  pushQualitativeMetric(profile.metrics.answer_structure_score, sessionId, answerStructureScore, ts);

  await inferRespondsBetterTo(userId, profile);

  checkMastery(profile);
  profile.sessions_completed += 1;
  if (!profile.active_focus_area) profile.proposed_focus_area = proposeFocusArea(profile);

  return saveCommunicationProfile(userId, profile);
}
