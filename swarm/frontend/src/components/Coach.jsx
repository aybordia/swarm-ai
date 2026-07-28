import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Microphone, Stop, CircleNotch } from "@phosphor-icons/react";
import { getJSON, postJSON } from "../lib/api";
import { speakText, stopAllAudio } from "../hooks/useVoiceOutput";
import { useElevenLabsSTT } from "../hooks/useElevenLabsSTT";

const sv = {
  initial: { opacity: 0, filter: "blur(10px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, filter: "blur(8px)", transition: { duration: 0.35 } },
};

const FOCUS_LABELS = {
  answer_structure: "giving context before detail",
  response_latency: "your response pacing",
  filler_words: "filler words",
  answer_length: "answer length",
};

const VOICE_MODE_KEY = "swarm_coach_voice_mode";

// The Coach — the persistent front door (Feature 1). Distinct from Dashboard
// (now reachable as session history) and ModeSelect (the full drill library,
// still two taps away via "Practice library"). Proposes, never auto-starts.
export default function Coach({ user, getIdToken, onOpenLibrary, onOpenProgress, onOpenHistory, onFreeformLaunch }) {
  const [profile, setProfile] = useState(null);
  const [greeting, setGreeting] = useState("");
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [voiceId, setVoiceId] = useState(null);
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem(VOICE_MODE_KEY) || "text");
  const [draft, setDraft] = useState("");
  const [focusBusy, setFocusBusy] = useState(false);
  const spokenRef = useRef(false);

  const firstName = user?.given_name || user?.name?.split(" ")[0] || "there";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken?.();
        const [{ profile: p }, greetingData] = await Promise.all([
          getJSON("/api/communication-profile", token),
          getJSON("/api/coach/greeting", token),
        ]);
        if (cancelled) return;
        setProfile(p);
        setGreeting(greetingData.greeting);
        setVoiceId(greetingData.voiceId);
      } catch (e) {
        console.error("[Coach] load failed:", e);
        if (!cancelled) setGreeting(`Hi ${firstName}. What would you like to work on today?`);
      }
      if (!cancelled) setGreetingLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIdToken]);

  // Voice-first: read the greeting aloud once it's ready. Never in text mode —
  // "never force voice" applies to output too, not just input.
  useEffect(() => {
    if (voiceMode !== "voice" || greetingLoading || !greeting || spokenRef.current) return;
    spokenRef.current = true;
    (async () => {
      const audio = await speakText({ text: greeting, voiceId });
      audio?.play?.().catch(() => {});
    })();
  }, [voiceMode, greetingLoading, greeting, voiceId]);

  useEffect(() => () => stopAllAudio(), []);

  const { start, stop, isListening, isProcessing, micError } = useElevenLabsSTT({
    onResult: (t) => setDraft(d => (d ? `${d.trim()} ${t}` : t)),
    silenceThresholdMs: Infinity,
  });

  const setVoicePref = (nextMode) => {
    if (nextMode === voiceMode) return;
    stopAllAudio();
    if (isListening) stop();
    setVoiceMode(nextMode);
    localStorage.setItem(VOICE_MODE_KEY, nextMode);
  };

  const confirmFocus = async (area) => {
    setFocusBusy(true);
    try {
      const token = await getIdToken();
      const { profile: updated } = await postJSON("/api/communication-profile/focus-area", { area }, token);
      setProfile(updated);
    } catch (e) {
      console.error("[Coach] confirm focus failed:", e);
    }
    setFocusBusy(false);
  };

  const submitFreeform = () => {
    const text = draft.trim();
    if (!text || text.length < 4) return;
    if (isListening) stop();
    stopAllAudio();
    onFreeformLaunch(text);
  };

  const proposedArea = !profile?.active_focus_area ? profile?.proposed_focus_area : null;

  return (
    <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--ink)" }}>
      <div className="ambient" />
      <div className="noise" />

      <div style={{
        position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto",
        padding: "84px 24px 100px", display: "flex", flexDirection: "column", gap: 26,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.png" alt="Swarm AI logo" width={30} height={30} style={{ display: "block" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 15, letterSpacing: "0.3em", color: "var(--dim)", textTransform: "uppercase" }}>
            Your Coach
          </span>
        </div>

        {/* Greeting */}
        <div style={{ minHeight: 90 }}>
          {greetingLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2].map(i => (
                <motion.div key={i}
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }}
                  style={{ height: 30, width: i === 1 ? "90%" : "60%", borderRadius: 8, background: "rgba(255,255,255,0.05)" }}
                />
              ))}
            </div>
          ) : (
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
              style={{ fontFamily: "var(--display)", fontWeight: 300, fontSize: "clamp(28px, 4.2vw, 40px)", lineHeight: 1.4, color: "var(--text)" }}>
              {greeting}
            </motion.h1>
          )}
        </div>

        {/* Focus area propose/confirm — the coach proposes, the user disposes */}
        {!greetingLoading && proposedArea && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card"
            style={{ padding: "18px 22px", borderTop: "2px solid var(--honey)", display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 17, color: "var(--text)", lineHeight: 1.6 }}>
              Want to keep working on {FOCUS_LABELS[proposedArea] || proposedArea}? Totally your call.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={focusBusy} onClick={() => confirmFocus(proposedArea)} style={{ height: 40, padding: "0 16px", fontSize: 15 }}>
                Yes, let's continue that
              </button>
              <button className="btn btn-ghost" disabled={focusBusy} onClick={() => confirmFocus(null)} style={{ height: 40, padding: "0 16px", fontSize: 15 }}>
                Not that — something else
              </button>
            </div>
          </motion.div>
        )}
        {!greetingLoading && profile?.active_focus_area && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--mono)", fontSize: 14, color: "var(--calm)", letterSpacing: "0.06em" }}>
            <span>CURRENT FOCUS: {(FOCUS_LABELS[profile.active_focus_area] || profile.active_focus_area).toUpperCase()}</span>
            <button className="btn btn-ghost" disabled={focusBusy} onClick={() => confirmFocus(null)} style={{ height: 26, padding: "0 10px", fontSize: 13 }}>
              Change
            </button>
          </div>
        )}

        {/* Free-form — "what's actually on your mind" */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="coach-input" style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--dim)", letterSpacing: "0.12em" }}>
            OR TELL ME WHAT'S ACTUALLY GOING ON
          </label>
          <div style={{ position: "relative" }}>
            <textarea
              id="coach-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={
                isListening ? "Listening. Speak whenever you're ready…"
                : isProcessing ? "Writing down what you said…"
                : "e.g. I have a doctor's appointment Thursday and I don't know how to explain my symptoms"
              }
              readOnly={voiceMode === "voice"}
              rows={3}
              style={{
                width: "100%",
                background: "var(--surface)",
                border: `1px solid ${isListening ? "rgba(116,185,160,0.5)" : "var(--line)"}`,
                borderRadius: "var(--radius)",
                padding: voiceMode === "voice" ? "16px 64px 16px 18px" : "16px 18px",
                fontSize: 18, fontFamily: "var(--ui)", fontWeight: 300, color: "var(--text)",
                outline: "none", resize: "none", lineHeight: 1.6,
              }}
            />
            {voiceMode === "voice" && (
              <button
                onClick={() => isListening ? stop() : start()}
                disabled={isProcessing}
                style={{
                  position: "absolute", right: 12, bottom: 14,
                  height: 40, borderRadius: 999, padding: "0 16px",
                  border: `1px solid ${isListening ? "rgba(116,185,160,0.55)" : "rgba(228,163,57,0.45)"}`,
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 14, fontFamily: "var(--ui)", fontWeight: 500, cursor: "pointer",
                  background: isListening ? "var(--calm-soft)" : "var(--honey-soft)",
                  color: isListening ? "var(--calm)" : "var(--honey)",
                }}
              >
                {isProcessing ? <CircleNotch size={16} weight="bold" style={{ animation: "rotateSlow 1s linear infinite" }} />
                  : isListening ? <Stop size={15} weight="fill" /> : <Microphone size={16} weight="regular" />}
                {isProcessing ? "" : isListening ? "Stop" : "Speak"}
              </button>
            )}
          </div>
          {micError && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--alert)" }}>{micError}</span>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div role="group" aria-label="Input mode" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 999, background: "var(--surface)", border: "1px solid var(--line)" }}>
              {[{ key: "text", label: "Text" }, { key: "voice", label: "Voice" }].map(o => (
                <button key={o.key} onClick={() => setVoicePref(o.key)} aria-pressed={voiceMode === o.key}
                  style={{
                    padding: "5px 12px", borderRadius: 999, border: "none", cursor: "pointer",
                    background: voiceMode === o.key ? "var(--honey-soft)" : "transparent",
                    color: voiceMode === o.key ? "var(--honey)" : "var(--dim)",
                    fontFamily: "var(--ui)", fontSize: 13.5, fontWeight: 500,
                  }}>
                  {o.label}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" disabled={draft.trim().length < 4} onClick={submitFreeform} style={{ height: 42, padding: "0 20px", fontSize: 16 }}>
              Build a session around this
            </button>
          </div>
        </div>

        {/* Quick access — the drill library is two taps away, never the front door */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <button className="card" onClick={onOpenLibrary} style={{ padding: "16px 18px", textAlign: "left", cursor: "pointer" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 18, color: "var(--text)" }}>Practice library</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Pick a drill yourself</div>
          </button>
          <button className="card" onClick={onOpenProgress} style={{ padding: "16px 18px", textAlign: "left", cursor: "pointer" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 18, color: "var(--text)" }}>Your progress</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Trends, goals, preferences</div>
          </button>
          <button className="card" onClick={onOpenHistory} style={{ padding: "16px 18px", textAlign: "left", cursor: "pointer" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 18, color: "var(--text)" }}>Past sessions</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", marginTop: 4 }}>What you've already done</div>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
