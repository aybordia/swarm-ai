import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getJSON, postJSON, downloadJSON } from "../lib/api";
import MetricTrendLine from "./MetricTrendLine";

const sv = {
  initial: { opacity: 0, filter: "blur(10px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, filter: "blur(8px)", transition: { duration: 0.3 } },
};

const METRIC_META = {
  avg_speaking_pace_wpm: { label: "Speaking pace", unit: " wpm" },
  avg_response_latency_sec: { label: "Response latency", unit: "s" },
  filler_word_rate: { label: "Filler word rate", unit: "" },
  answer_length_avg_sec: { label: "Answer length", unit: "s" },
  interruption_count: { label: "Interruptions used", unit: "" },
};

const FOCUS_LABELS = {
  answer_structure: "Answer structure",
  response_latency: "Response pacing",
  filler_words: "Filler words",
  answer_length: "Answer length",
};

const TONE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "supportive", label: "Supportive" },
  { value: "neutral", label: "Neutral" },
  { value: "challenging", label: "Challenging" },
];

function PreferencesEditor({ profile, getIdToken, onUpdated }) {
  const learned = profile?.user_preferences_learned || {};
  const [prefersLongerThinkingTime, setPrefersLongerThinkingTime] = useState(!!learned.prefers_longer_thinking_time);
  const [respondsBetterTo, setRespondsBetterTo] = useState(learned.responds_better_to || "");
  const [strugglesAfterNFollowups, setStrugglesAfterNFollowups] = useState(
    Number.isFinite(learned.struggles_after_n_followups) ? String(learned.struggles_after_n_followups) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const token = await getIdToken();
      const { profile: updated } = await postJSON("/api/communication-profile/preferences", {
        prefers_longer_thinking_time: prefersLongerThinkingTime,
        responds_better_to: respondsBetterTo || null,
        struggles_after_n_followups: strugglesAfterNFollowups === "" ? null : Number(strugglesAfterNFollowups),
      }, token);
      onUpdated?.(updated);
      setSaved(true);
    } catch (e) {
      console.error("[ProgressView] save preferences failed:", e);
    }
    setSaving(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = await getIdToken();
      await downloadJSON("/api/communication-profile/export", token, "communication-profile.json");
    } catch (e) {
      console.error("[ProgressView] export failed:", e);
    }
    setExporting(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const token = await getIdToken();
      await postJSON("/api/communication-profile/delete", {}, token);
      onUpdated?.(null);
    } catch (e) {
      console.error("[ProgressView] delete failed:", e);
    }
    setDeleting(false);
    setConfirmingDelete(false);
  };

  return (
    <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.16em" }}>
        YOUR LEARNED PREFERENCES
      </div>
      <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 16, color: "var(--dim)", lineHeight: 1.6 }}>
        These are inferred from how you've used the app — never hidden, always yours to change.
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--ui)", fontSize: 17, color: "var(--text)" }}>
        <input type="checkbox" checked={prefersLongerThinkingTime} onChange={e => setPrefersLongerThinkingTime(e.target.checked)} />
        I usually want more time to think before answering
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--ui)", fontSize: 17, color: "var(--text)" }}>
        I respond better to this interview tone:
        <select value={respondsBetterTo} onChange={e => setRespondsBetterTo(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, background: "var(--raised)", border: "1px solid var(--line)", color: "var(--text)", fontFamily: "var(--ui)", fontSize: 16 }}>
          {TONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--ui)", fontSize: 17, color: "var(--text)" }}>
        Move on after this many follow-ups on one question:
        <input type="number" min="1" max="6" value={strugglesAfterNFollowups}
          onChange={e => setStrugglesAfterNFollowups(e.target.value)}
          placeholder="Let the app decide"
          style={{ padding: "8px 10px", borderRadius: 8, background: "var(--raised)", border: "1px solid var(--line)", color: "var(--text)", fontFamily: "var(--ui)", fontSize: 16, width: 160 }} />
      </label>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" disabled={saving} onClick={save} style={{ height: 44, padding: "0 18px", fontSize: 16 }}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save preferences"}
        </button>
        <button className="btn btn-ghost" disabled={exporting} onClick={handleExport} style={{ height: 44, padding: "0 18px", fontSize: 16 }}>
          {exporting ? "Exporting…" : "Export my data"}
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        {!confirmingDelete ? (
          <button className="btn btn-ghost" onClick={() => setConfirmingDelete(true)} style={{ height: 40, padding: "0 16px", fontSize: 15, color: "var(--alert)" }}>
            Delete my communication profile
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontFamily: "var(--ui)", fontSize: 16, color: "var(--dim)", lineHeight: 1.6 }}>
              This deletes your derived metrics, trends, and learned preferences. Your saved session transcripts are not affected. This can't be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-primary" disabled={deleting} onClick={handleDelete} style={{ height: 40, padding: "0 16px", fontSize: 15 }}>
                {deleting ? "Deleting…" : "Yes, delete it"}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmingDelete(false)} style={{ height: 40, padding: "0 16px", fontSize: 15 }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProgressView({ onBack, getIdToken }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        const { profile } = await getJSON("/api/communication-profile", token);
        if (!cancelled) setProfile(profile);
      } catch (e) {
        console.error("[ProgressView] load failed:", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [getIdToken]);

  const confirmFocus = async (area) => {
    setBusy(true);
    try {
      const token = await getIdToken();
      const { profile: updated } = await postJSON("/api/communication-profile/focus-area", { area }, token);
      setProfile(updated);
    } catch (e) {
      console.error("[ProgressView] confirm focus failed:", e);
    }
    setBusy(false);
  };

  if (loading) {
    return (
      <motion.div className="screen" variants={sv} initial="initial" animate="animate" exit="exit"
        style={{ background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="noise" />
        <span style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--muted)", letterSpacing: "0.14em" }}>
          LOADING YOUR PROGRESS…
        </span>
      </motion.div>
    );
  }

  const metrics = profile?.metrics || {};
  const trendMetrics = Object.entries(METRIC_META).filter(([key]) => (metrics[key]?.history?.length || 0) >= 2);

  return (
    <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--ink)" }}>
      <div className="noise" />
      <div className="ambient" />

      <div style={{
        position: "relative", zIndex: 1, maxWidth: 720, margin: "0 auto",
        padding: "84px 24px 100px", display: "flex", flexDirection: "column", gap: 26,
      }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.2em", marginBottom: 12 }}>
            YOUR PROGRESS
          </div>
          <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 300, lineHeight: 1.15 }}>
            {profile ? `${profile.sessions_completed || 0} session${profile.sessions_completed === 1 ? "" : "s"} so far.` : "No profile yet."}
          </h1>
        </div>

        {profile?.proposed_focus_area && !profile?.active_focus_area && (
          <div className="card" style={{ padding: "20px 24px", borderTop: "2px solid var(--honey)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--honey)", letterSpacing: "0.14em" }}>SUGGESTED FOCUS</div>
            <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, lineHeight: 1.6, color: "var(--text)" }}>
              Want to focus on {FOCUS_LABELS[profile.proposed_focus_area] || profile.proposed_focus_area} next time? You can also pick something else, or skip this — it's your call.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => confirmFocus(profile.proposed_focus_area)} style={{ height: 44, padding: "0 18px", fontSize: 16 }}>
                Yes, focus on that
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => confirmFocus(null)} style={{ height: 44, padding: "0 18px", fontSize: 16 }}>
                Not right now
              </button>
            </div>
          </div>
        )}

        {profile?.active_focus_area && (
          <div className="card" style={{ padding: "18px 22px", borderTop: "2px solid var(--calm)" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.14em", marginBottom: 6 }}>CURRENT FOCUS</div>
            <div style={{ fontFamily: "var(--ui)", fontSize: 19, color: "var(--text)" }}>
              {FOCUS_LABELS[profile.active_focus_area] || profile.active_focus_area}
            </div>
            <button className="btn btn-ghost" disabled={busy} onClick={() => confirmFocus(null)} style={{ marginTop: 10, height: 36, fontSize: 15, padding: "0 14px" }}>
              Change focus
            </button>
          </div>
        )}

        {trendMetrics.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {trendMetrics.map(([key, meta]) => (
              <MetricTrendLine key={key} label={meta.label} unit={meta.unit} history={metrics[key].history} />
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: "24px", textAlign: "center", fontFamily: "var(--ui)", fontSize: 18, color: "var(--dim)" }}>
            Trends appear here after a couple of sessions.
          </div>
        )}

        {(profile?.mastered_areas || []).length > 0 && (
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.16em", marginBottom: 10 }}>
              AREAS YOU'VE BUILT UP
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {profile.mastered_areas.map(area => (
                <span key={area} style={{
                  padding: "8px 16px", borderRadius: 999,
                  background: "var(--calm-soft)", border: "1px solid rgba(116,185,160,0.3)",
                  fontFamily: "var(--ui)", fontSize: 16, color: "var(--calm)",
                }}>
                  {FOCUS_LABELS[area] || area}
                </span>
              ))}
            </div>
          </div>
        )}

        {profile && <PreferencesEditor profile={profile} getIdToken={getIdToken} onUpdated={setProfile} />}

        <button className="btn btn-ghost" onClick={onBack} style={{ alignSelf: "flex-start", fontSize: 18 }}>
          Back
        </button>
      </div>
    </motion.div>
  );
}
