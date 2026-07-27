import { getSessions, saveSession, getSession } from "../lib/sessionStore.js";
import { updateCommunicationProfileFromSession, computeMetricsSnapshot } from "../lib/communicationProfileStore.js";

export async function listSessions(req, res) {
  try {
    const userId = req.user.sub;
    const sessions = await getSessions(userId);
    // clarityScore/overallVerdict (legacy scored debrief schema) intentionally
    // dropped — the current debrief is non-scored (see routes/debrief.js) and
    // never populates them. Dashboard/ProgressView read metricsSnapshot +
    // GET /api/communication-profile instead.
    res.json(sessions.map(s => ({
      id:              s.id,
      situation:       s.situation,
      createdAt:       s.createdAt,
      focus:           s.debrief?.focus ?? null,
      metricsSnapshot: s.metricsSnapshot ?? null,
      turnCount:       s.history?.length ?? 0,
    })));
  } catch (err) {
    console.error("listSessions error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function saveSessionRoute(req, res) {
  try {
    const userId = req.user.sub;
    const { situation, history, debrief, sessionData, turnMetrics, extendTimeUsed } = req.body;
    const metricsSnapshot = computeMetricsSnapshot(turnMetrics);
    const session = await saveSession(userId, { situation, history, debrief, sessionData, metricsSnapshot });
    res.json({ id: session.id });

    // Aggregate into the persistent communication profile after responding —
    // best-effort, never blocks or fails the save itself.
    updateCommunicationProfileFromSession(userId, {
      sessionId: session.id,
      turnMetrics,
      answerStructureScore: debrief?.answer_structure_score ?? null,
      extendTimeUsed: !!extendTimeUsed,
    }).catch(err => console.error("[sessions] communication profile aggregation failed:", err.message));
  } catch (err) {
    console.error("saveSession error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function getSessionRoute(req, res) {
  try {
    const userId = req.user.sub;
    const session = await getSession(userId, req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json(session);
  } catch (err) {
    console.error("getSession error:", err);
    res.status(500).json({ error: err.message });
  }
}
