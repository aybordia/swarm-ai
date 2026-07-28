// The persistent cross-session communication profile — read, edited, exported,
// and deleted here. POST-only for the mutating actions (matches index.js's
// existing CORS methods allowlist: GET/POST/OPTIONS — no need to widen it).
import {
  getCommunicationProfile,
  patchUserPreferences,
  resetUserPreference,
  setActiveFocusArea,
  setUserGoals,
  exportCommunicationProfile,
  deleteCommunicationProfile,
} from "../lib/communicationProfileStore.js";

const ALLOWED_PREF_KEYS = [
  "prefers_longer_thinking_time",
  "responds_better_to",
  "struggles_after_n_followups",
  "preferred_session_length_min",
  "prefers_text_over_voice_when_tired",
];

export async function getCommunicationProfileRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  const { _inference, ...profile } = await getCommunicationProfile(userId);
  res.json({ profile });
}

export async function patchPreferencesRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  const patch = {};
  for (const key of ALLOWED_PREF_KEYS) {
    if (key in (req.body || {})) patch[key] = req.body[key];
  }
  const profile = await patchUserPreferences(userId, patch);
  const { _inference, ...publicProfile } = profile;
  res.json({ profile: publicProfile });
}

export async function resetPreferenceRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  const key = req.body?.key;
  if (!ALLOWED_PREF_KEYS.includes(key)) return res.status(400).json({ error: "unknown preference key" });
  const profile = await resetUserPreference(userId, key);
  const { _inference, ...publicProfile } = profile;
  res.json({ profile: publicProfile });
}

export async function setUserGoalsRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  const profile = await setUserGoals(userId, req.body?.goals);
  const { _inference, ...publicProfile } = profile;
  res.json({ profile: publicProfile });
}

export async function confirmFocusAreaRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  const profile = await setActiveFocusArea(userId, req.body?.area ?? null);
  const { _inference, ...publicProfile } = profile;
  res.json({ profile: publicProfile });
}

export async function exportCommunicationProfileRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  const profile = await exportCommunicationProfile(userId);
  res.setHeader("Content-Disposition", `attachment; filename="communication-profile.json"`);
  res.json(profile);
}

export async function deleteCommunicationProfileRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });
  // Deletes only the derived-metrics store — session transcripts in
  // sessionStore.js are untouched (surfaced explicitly in the settings UI copy).
  await deleteCommunicationProfile(userId);
  res.json({ deleted: true });
}
