// Peer-to-peer practice: matching, status, and safety endpoints.
// All routes sit behind Google auth (verified email). Additional gate:
// at least one completed AI-mode session before peer matching unlocks,
// to reduce anonymous-abuse risk from fresh accounts.
import { joinQueue, getStatus, leaveQueue, endMatch, blockUser, fileReport } from "../lib/peerQueue.js";
import { createPeerRoom } from "../lib/videoRoom.js";
import { getSessions } from "../lib/sessionStore.js";
import { listModules } from "../modules/index.js";

// Peer (Jitsi, two real humans) is a modifier available on any implemented
// drill, not a fixed pair of top-level modes — `custom` is excluded since
// it's per-user free text, not a stable topic to match peers on. getModule()
// falls back to "interview" for an unrecognized key, so membership must be
// checked against the real registry rather than trusting a truthy lookup.
function isPeerEligibleMode(mode) {
  if (mode === "custom") return false;
  return listModules().some(m => m.key === mode && m.implemented);
}

async function checkEligibility(req, res) {
  const userId = req.user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (req.user?.email_verified === false) {
    res.status(403).json({ error: "A verified email is required for peer practice." });
    return null;
  }
  try {
    const sessions = await getSessions(userId);
    if (!sessions?.length) {
      res.status(403).json({
        error: "Peer practice unlocks after you complete and save one AI practice session first.",
        code: "NEEDS_AI_SESSION",
      });
      return null;
    }
  } catch (e) {
    console.error("[peer] eligibility check failed:", e.message);
    // Fail closed: if we can't verify eligibility, don't unlock matching
    res.status(503).json({ error: "Could not verify eligibility right now. Please try again." });
    return null;
  }
  return userId;
}

export async function peerJoin(req, res) {
  const userId = await checkEligibility(req, res);
  if (!userId) return;

  const { handle, mode, topic } = req.body || {};
  const cleanHandle = String(handle || "").trim().slice(0, 24);
  if (!cleanHandle) return res.status(400).json({ error: "Choose a display name first (it doesn't have to be your real name)." });
  if (!isPeerEligibleMode(mode)) return res.status(400).json({ error: "mode must be one of the practice library's implemented drills" });

  try {
    const result = await joinQueue({ userId, handle: cleanHandle, mode, topic }, createPeerRoom);
    res.json(result);
  } catch (e) {
    console.error("[peer] join failed:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}

export async function peerStatus(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  res.json(getStatus(userId));
}

export async function peerCancel(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  leaveQueue(userId);
  res.json({ status: "idle" });
}

export async function peerEnd(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  endMatch(userId);
  res.json({ status: "idle" });
}

export async function peerReport(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { reportedId, matchId, reason, details } = req.body || {};
  if (!reason?.trim()) return res.status(400).json({ error: "Please include a short reason." });
  fileReport({ reporterId: userId, reportedId, matchId, reason, details });
  res.json({ ok: true, message: "Report received. Thank you for helping keep this space safe." });
}

export async function peerBlock(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { blockedId } = req.body || {};
  if (!blockedId) return res.status(400).json({ error: "blockedId is required" });
  blockUser(userId, blockedId);
  endMatch(userId);
  res.json({ ok: true, message: "Blocked. You will never be matched with this person again." });
}
