import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getJSON, postJSON } from "../lib/api";

// Session-start continuity greeting (Feature 2): references the user's
// confirmed focus area from their communication profile and always offers an
// opt-out — the AI proposes, the user picks, never the other way around.
const FOCUS_LABELS = {
  answer_structure: "structuring your answers",
  response_latency: "your response pacing",
  filler_words: "filler words",
  answer_length: "answer length",
};

export default function ContinuityPrompt({ getIdToken }) {
  const [profile, setProfile] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken?.();
        const { profile } = await getJSON("/api/communication-profile", token);
        if (!cancelled) setProfile(profile);
      } catch {
        /* first session, or profile unavailable — say nothing */
      }
    })();
    return () => { cancelled = true; };
  }, [getIdToken]);

  if (dismissed || !profile?.active_focus_area || !profile.sessions_completed) return null;
  const label = FOCUS_LABELS[profile.active_focus_area] || profile.active_focus_area;

  const chooseSomethingElse = async () => {
    setDismissed(true);
    try {
      const token = await getIdToken?.();
      await postJSON("/api/communication-profile/focus-area", { area: null }, token);
    } catch {
      /* best-effort — no functional impact if this fails */
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="card" style={{ padding: "16px 20px", borderTop: "2px solid var(--calm)", display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, color: "var(--text)", lineHeight: 1.6 }}>
        Last session we worked on {label}. Want to continue with that, or focus on something else today?
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={() => setDismissed(true)} style={{ height: 38, padding: "0 14px", fontSize: 15 }}>
          Keep focusing on that
        </button>
        <button className="btn btn-ghost" onClick={chooseSomethingElse} style={{ height: 38, padding: "0 14px", fontSize: 15 }}>
          Focus on something else
        </button>
      </div>
    </motion.div>
  );
}
