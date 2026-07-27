import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { postJSON } from "../lib/api";
import { speakText, stopAllAudio } from "../hooks/useVoiceOutput";
import { saveSession } from "../lib/localSessions";

function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(base64).split("").map(
      c => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`
    ).join("")));
  } catch { return null; }
}

const READER_VOICE = "pNInz6obpgDQGcFmaJgB"; // Adam — neutral debrief reader

const CATEGORY_LABELS = {
  posture: "Posture",
  head_tilt: "Head tilt",
  mouth_movement: "Speaking movement",
  pacing: "Thinking time",
};

const CATEGORY_PREF_KEY = "swarm_signal_categories";

function loadCategoryPrefs() {
  try { return JSON.parse(localStorage.getItem(CATEGORY_PREF_KEY) || "[]"); } catch { return []; }
}

const sv = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, transition: { duration: 0.35 } },
};

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] },
});

export default function Debrief({ sessionResult, situation, onRunAgain, onAskSwarm, onPracticeThisNow, getIdToken }) {
  const [debrief, setDebrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backendOutdated, setBackendOutdated] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | failed
  const savedRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  // Which tracking categories the user has opted in to see — default: none (hidden)
  const [selectedCategories, setSelectedCategories] = useState(loadCategoryPrefs);
  const currentAudioRef = useRef(null);
  const fetchedRef = useRef(false);

  const history = sessionResult?.history || [];
  const sessionData = sessionResult?.sessionData || null;
  const signalData = sessionResult?.signalData || null;
  const turnMetrics = sessionResult?.turnMetrics || [];
  const extendTimeUsed = !!sessionResult?.extendTimeUsed;
  const personas = sessionData?.personas || [];
  // Non-evaluative modules (conversation, networking, …) get a null tone from
  // the architect — reuse that signal, and fall back to the debrief response's
  // own mode field once it's loaded (mode:"interview" only for evaluative
  // modules — see backend/routes/debrief.js), so any current or future
  // non-evaluative module renders the same low-stakes recap view.
  const isConvo = !sessionData?.tone || (debrief && debrief.mode !== "interview");

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const token = await getIdToken();
        const result = await postJSON("/api/debrief", {
          fullTranscript: history,
          situation,
          sessionData,
          signalData,
          userSelectedCategories: loadCategoryPrefs(),
        }, token);

        if (Array.isArray(result?.persona_impressions)) {
          setDebrief(result);
        } else if (result?.overallVerdict || result?.clarityScore !== undefined) {
          // Older backend version still deployed — adapt its response so
          // results always show instead of an empty page
          setBackendOutdated(true);
          setDebrief({
            transcript: history.map(t => `${t.speaker}: ${t.text}`).join("\n"),
            persona_impressions: [
              result.overallVerdict && { persona: "The panel", impression: result.overallVerdict },
              result.priorityFix && { persona: "One thing to focus on", impression: result.priorityFix },
              result.bestMoment?.quote && { persona: "A strong moment", impression: `"${result.bestMoment.quote}" ${result.bestMoment.reason || ""}` },
            ].filter(Boolean),
            signal_summary: {},
            user_selected_categories: [],
            session_facts: null,
          });
        } else {
          setError("The debrief service returned an unexpected response.");
        }
      } catch (e) {
        setError(e.message || "Could not build your debrief.");
        setShowTranscript(true); // never leave the page empty
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopAllAudio(), []);

  // Auto-save the session as soon as the debrief is ready — ending a session
  // should never require a manual click to not lose the record of it.
  const persistSession = async () => {
    if (savedRef.current || !history.length) return;
    savedRef.current = true;
    setSaveStatus("saving");
    try {
      const token = await getIdToken();
      const result = await postJSON("/api/sessions/save", { situation, history, debrief, sessionData, turnMetrics, extendTimeUsed }, token);
      setSavedSessionId(result.id);
      setSaveStatus("saved");
    } catch (e) {
      console.error("[debrief] backend save failed, falling back to local:", e);
      // Fall back to this device's local storage so the session isn't lost,
      // keyed by the real signed-in user (not a shared placeholder id)
      try {
        const token = await getIdToken();
        const payload = decodeJwtPayload(token);
        const userId = payload?.sub || "unknown-user";
        const s = saveSession(userId, { situation, history, debrief, sessionData });
        setSavedSessionId(s.id);
        setSaveStatus("saved");
      } catch (e2) {
        console.error("[debrief] local save fallback also failed:", e2);
        savedRef.current = false; // allow retry
        setSaveStatus("failed");
      }
    }
  };

  useEffect(() => {
    if (debrief && !loading) persistSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debrief, loading]);

  const toggleCategory = (cat) => {
    setSelectedCategories(prev => {
      const next = prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat];
      localStorage.setItem(CATEGORY_PREF_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleSave = () => {
    if (saveStatus === "saved" || saveStatus === "saving") return;
    persistSession();
  };

  const handleListen = async () => {
    if (isSpeaking) { stopAllAudio(); setIsSpeaking(false); return; }
    const script = (debrief?.persona_impressions || [])
      .map(i => `${i.persona} says: ${i.impression}`)
      .join(" ... ");
    if (!script) return;
    setIsSpeaking(true);
    const audio = await speakText({ text: script, voiceId: READER_VOICE });
    if (audio && typeof audio.play === "function") {
      currentAudioRef.current = audio;
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      audio.play().catch(() => setIsSpeaking(false));
    } else {
      setIsSpeaking(false);
    }
  };

  const personaColor = (name) =>
    personas.find(p => p.name === name)?.color || "var(--primary)";

  const availableSignals = Object.keys(debrief?.signal_summary || {});

  /* ── Loading ── */
  if (loading) {
    return (
      <motion.div className="screen" variants={sv} initial="initial" animate="animate" exit="exit"
        style={{ background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="noise" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div className="orb" style={{ width: 72, height: 72, background: "radial-gradient(circle at 35% 35%, #9B8DFF, #4A3DB8)", color: "#7B6CFF" }} />
          <div style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--muted)", letterSpacing: "0.18em" }}>
            YOUR PANEL IS WRITING THEIR IMPRESSIONS…
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--bg)" }}>
      <div className="noise" />
      <div className="ambient" />

      <div style={{
        position: "relative", zIndex: 1, maxWidth: 720, margin: "0 auto",
        padding: "84px 24px 120px", display: "flex", flexDirection: "column", gap: 28,
      }}>

        {/* Header */}
        <motion.div {...fadeUp(0)}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: isConvo ? "var(--calm)" : "var(--muted)", letterSpacing: "0.2em", marginBottom: 12 }}>
            {isConvo ? "OPTIONAL RECAP" : "PRIVATE DEBRIEF"}
          </div>
          <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(40px, 6vw, 60px)", fontWeight: 300, lineHeight: 1.15 }}>
            {isConvo ? "Nice chat." : "How it went."}
          </h1>
        </motion.div>

        {error && (
          <div style={{
            padding: "14px 18px", borderRadius: 12, background: "rgba(217,139,139,0.07)",
            border: "1px solid rgba(217,139,139,0.25)", fontFamily: "var(--ui)", fontSize: 18,
            color: "var(--alert)", lineHeight: 1.6,
          }}>
            {error} Your full transcript is still available below.
          </div>
        )}

        {backendOutdated && (
          <div style={{
            padding: "14px 18px", borderRadius: 12, background: "var(--honey-soft)",
            border: "1px solid rgba(228,163,57,0.3)", fontFamily: "var(--ui)", fontSize: 18,
            color: "var(--honey)", lineHeight: 1.6,
          }}>
            The results server is running an older version, so this is a simplified debrief.
            Redeploy the backend to get per-interviewer impressions and tracking observations.
          </div>
        )}

        {/* Voice — two lines, that's it */}
        {!isConvo && (debrief?.focus || (debrief?.communication_observations || []).length > 0) && (
          <motion.div {...fadeUp(0.12)} className="card" style={{ padding: "22px 26px", borderTop: "2px solid var(--calm)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.16em" }}>
              VOICE
            </div>
            {debrief?.focus && (
              <p style={{ fontFamily: "var(--ui)", fontWeight: 400, fontSize: 21, lineHeight: 1.65, color: "var(--text)" }}>
                {debrief.focus}
              </p>
            )}
            {debrief?.communication_observations?.[0] && (
              <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.65, color: "var(--text-2)" }}>
                {debrief.communication_observations[0].observation}
              </p>
            )}
          </motion.div>
        )}

        {/* Camera — up to three lines, opt-in */}
        {availableSignals.length > 0 && (
          <motion.div {...fadeUp(0.16)} className="card" style={{ padding: "22px 26px", borderTop: "2px solid var(--honey)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--honey)", letterSpacing: "0.16em" }}>
                CAMERA
              </span>
              {availableSignals.map(cat => {
                const on = selectedCategories.includes(cat);
                return (
                  <button key={cat} onClick={() => toggleCategory(cat)} aria-pressed={on}
                    style={{
                      padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                      background: on ? "var(--honey-soft)" : "transparent",
                      border: `1px solid ${on ? "rgba(228,163,57,0.45)" : "var(--line)"}`,
                      fontFamily: "var(--ui)", fontSize: 15,
                      color: on ? "var(--honey)" : "var(--dim)", transition: "all 0.2s",
                    }}>
                    {CATEGORY_LABELS[cat] || cat}
                  </button>
                );
              })}
            </div>
            {selectedCategories.filter(c => debrief.signal_summary[c]).slice(0, 3).map(cat => (
              <p key={cat} style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.65, color: "var(--text-2)" }}>
                <strong style={{ fontWeight: 500, color: "var(--text)" }}>{CATEGORY_LABELS[cat] || cat}:</strong> {debrief.signal_summary[cat]}
              </p>
            ))}
          </motion.div>
        )}

        {showDetail && (<>

        {/* Communication observations — per-dimension, descriptive, never collapsed */}
        {(debrief?.communication_observations || []).length > 0 && (
          <motion.div {...fadeUp(0.12)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.16em" }}>
              COMMUNICATION OBSERVATIONS
            </div>
            <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {debrief.communication_observations.map((obs, i) => (
                <div key={i}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.1em", marginBottom: 4 }}>
                    {(obs.dimension || "").toUpperCase()}
                  </div>
                  <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.7, color: "var(--text-2)" }}>
                    {obs.observation}
                    {obs.suggestion && (
                      <span style={{ color: "var(--dim)" }}> {obs.suggestion}</span>
                    )}
                  </p>
                </div>
              ))}
              {debrief.focus && (
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--honey)", letterSpacing: "0.1em", marginBottom: 4 }}>
                    IF YOU PRACTICE ONE THING NEXT
                  </div>
                  <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.7, color: "var(--text-2)" }}>
                    {debrief.focus}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Self-advocacy scripts — accommodations you can request in real interviews */}
        {(debrief?.self_advocacy || []).length > 0 && (
          <motion.div {...fadeUp(0.16)} className="card" style={{ padding: "20px 24px", borderTop: "2px solid var(--calm)" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.16em", marginBottom: 8 }}>
              THINGS YOU CAN SAY IN A REAL INTERVIEW
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {debrief.self_advocacy.map((line, i) => (
                <div key={i} style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: "var(--calm-soft)", border: "1px solid rgba(116,185,160,0.2)",
                  fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.6, color: "var(--text)",
                }}>
                  "{line}"
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Question-by-question teaching breakdown — a concrete stronger
            version of each answer, why it works, and a way to practice it
            immediately. Content/structure coaching only. */}
        {(debrief?.question_breakdown || []).length > 0 && (
          <motion.div {...fadeUp(0.18)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.16em" }}>
              QUESTION-BY-QUESTION BREAKDOWN
            </div>
            {debrief.question_breakdown.map((qb, i) => (
              <motion.div key={i} {...fadeUp(0.2 + i * 0.05)} className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12, borderTop: "2px solid var(--honey)" }}>
                <p style={{ fontFamily: "var(--ui)", fontWeight: 400, fontSize: 18, color: "var(--text)", lineHeight: 1.6 }}>
                  "{qb.question}"
                </p>
                {qb.what_worked && (
                  <div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.1em", marginBottom: 4 }}>WHAT WORKED</div>
                    <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, lineHeight: 1.65, color: "var(--text-2)" }}>{qb.what_worked}</p>
                  </div>
                )}
                {qb.stronger_version && (
                  <div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--honey)", letterSpacing: "0.1em", marginBottom: 4 }}>A STRONGER VERSION</div>
                    <p style={{
                      fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, lineHeight: 1.7, color: "var(--text)",
                      padding: "12px 14px", borderRadius: 10, background: "var(--honey-soft)", border: "1px solid rgba(228,163,57,0.25)",
                    }}>
                      "{qb.stronger_version}"
                    </p>
                  </div>
                )}
                {qb.why_it_works && (
                  <div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.1em", marginBottom: 4 }}>WHY IT WORKS</div>
                    <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, lineHeight: 1.65, color: "var(--text-2)" }}>{qb.why_it_works}</p>
                  </div>
                )}
                {qb.practice_prompt && onPracticeThisNow && (
                  <button className="btn btn-primary" onClick={() => onPracticeThisNow(qb.practice_prompt)}
                    style={{ alignSelf: "flex-start", height: 44, padding: "0 18px", fontSize: 17 }}>
                    Practice this now →
                  </button>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}

        </>)}

        {/* Persona impressions — the recap is always visible in casual mode */}
        {(showDetail || isConvo) && (
        <motion.div {...fadeUp(0.14)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.16em" }}>
              {isConvo ? "A SHORT RECAP" : "PANEL IMPRESSIONS"}
            </div>
            <button className="btn btn-ghost" onClick={handleListen} style={{ height: 30, fontSize: 16, padding: "0 14px" }}>
              {isSpeaking ? "■ Stop" : "▸ Listen"}
            </button>
          </div>
          {(debrief?.persona_impressions || []).map((imp, i) => (
            <motion.div key={i} {...fadeUp(0.18 + i * 0.06)} className="card" style={{ padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--display)", fontSize: 24, color: personaColor(imp.persona) }}>
                  {imp.persona}
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.06em" }}>
                  Simulated interviewer. Fictional, not a real person.
                </span>
              </div>
              <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.75, color: "var(--text-2)" }}>
                {imp.impression}
              </p>
            </motion.div>
          ))}
        </motion.div>
        )}

        {/* Transcript */}
        <motion.div {...fadeUp(0.36)}>
          <button className="btn btn-ghost" onClick={() => setShowTranscript(v => !v)} style={{ fontSize: 17 }}>
            {showTranscript ? "Hide full transcript" : "Read full transcript"}
          </button>
          <AnimatePresence>
            {showTranscript && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                style={{ overflow: "hidden" }}>
                <div className="card" style={{ padding: "20px 24px", marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                  {history.map((turn, i) => {
                    const isUser = turn.speaker === "You" || turn.speaker === "User";
                    return (
                      <div key={i}>
                        <div style={{
                          fontFamily: "var(--mono)", fontSize: 15, letterSpacing: "0.12em",
                          color: isUser ? "var(--amber)" : personaColor(turn.speaker), marginBottom: 3,
                        }}>
                          {turn.speaker.toUpperCase()}
                        </div>
                        <div style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, lineHeight: 1.7, color: "var(--text-2)" }}>
                          {turn.text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Actions */}
        <motion.div {...fadeUp(0.42)} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!isConvo && (
            <button className="btn btn-ghost" onClick={() => setShowDetail(v => !v)}
              style={{ height: 52, padding: "0 20px", fontSize: 19 }}>
              {showDetail ? "Less detail" : "More detail"}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => onAskSwarm(debrief)} style={{ padding: "0 24px" }}>
            Ask the Swarm →
          </button>
          <button className="btn btn-ghost" onClick={onRunAgain} style={{ height: 52, padding: "0 20px", fontSize: 19 }}>
            Practice again
          </button>
          <button className="btn btn-ghost" onClick={handleSave} disabled={saveStatus === "saved" || saveStatus === "saving"}
            style={{ height: 52, padding: "0 20px", fontSize: 19, opacity: saveStatus === "saved" ? 0.6 : 1 }}>
            {saveStatus === "saved" ? "✓ Saved to your account"
              : saveStatus === "saving" ? "Saving…"
              : saveStatus === "failed" ? "Retry save"
              : "Saving…"}
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
