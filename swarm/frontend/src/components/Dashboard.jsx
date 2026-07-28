import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getJSON } from "../lib/api";
import { getSessions as getLocalSessions } from "../lib/localSessions";

const sv = {
  initial: { opacity: 0, filter: "blur(10px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, filter: "blur(8px)", transition: { duration: 0.35 } },
};

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/* ── Practice heatmap (16-week activity grid) ── */
function PracticeHeatmap({ sessions }) {
  const [tooltip, setTooltip] = useState(null);
  const WEEKS = 16;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Count sessions per calendar day
  const counts = {};
  sessions.forEach(s => {
    const d = new Date(s.createdAt);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    counts[key] = (counts[key] || 0) + 1;
  });

  // Build WEEKS*7 day grid ending today
  const days = [];
  for (let i = WEEKS * 7 - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({ date: d, count: counts[d.getTime()] || 0 });
  }

  const maxCount = Math.max(...Object.values(counts), 1);

  // Group into columns (each column = one week, Mon→Sun)
  const cols = [];
  for (let w = 0; w < WEEKS; w++) {
    cols.push(days.slice(w * 7, (w + 1) * 7));
  }

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Month labels: track when month changes across column starts
  const monthLabels = [];
  cols.forEach((week, wi) => {
    const first = week[0].date;
    const prev = wi > 0 ? cols[wi - 1][0].date : null;
    if (!prev || first.getMonth() !== prev.getMonth()) {
      monthLabels.push({ wi, label: MONTH_NAMES[first.getMonth()] });
    }
  });

  const totalSessions = Object.values(counts).reduce((a, b) => a + b, 0);
  const activeDays = Object.values(counts).filter(c => c > 0).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.55 }}
      style={{
        background: "rgba(255,255,255,0.022)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "18px",
        padding: "20px 22px 16px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background glow */}
      <div style={{
        position: "absolute", top: 0, right: 0,
        width: 200, height: 200,
        background: "radial-gradient(circle at 80% 20%, rgba(123,108,255,0.07) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "rgba(106,103,128,0.5)", letterSpacing: "0.18em", marginBottom: "5px" }}>
            PRACTICE ACTIVITY
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <span style={{ fontFamily: "var(--display)", fontSize: "24px", color: "var(--primary)" }}>{activeDays}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", opacity: 0.5, alignSelf: "flex-end", paddingBottom: "2px", letterSpacing: "0.08em" }}>
              ACTIVE DAYS · {totalSessions} SESSIONS TOTAL
            </span>
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "8px", color: "rgba(106,103,128,0.4)", letterSpacing: "0.06em" }}>less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
            <div key={i} style={{
              width: 10, height: 10, borderRadius: "2px",
              background: v === 0 ? "rgba(255,255,255,0.04)" : `rgba(123,108,255,${0.2 + v * 0.8})`,
              boxShadow: v > 0 ? `0 0 ${v * 6}px rgba(123,108,255,${v * 0.35})` : "none",
            }} />
          ))}
          <span style={{ fontFamily: "var(--mono)", fontSize: "8px", color: "rgba(106,103,128,0.4)", letterSpacing: "0.06em" }}>more</span>
        </div>
      </div>

      {/* Month labels row */}
      <div style={{ position: "relative", marginBottom: "4px", height: "12px" }}>
        {monthLabels.map(({ wi, label }) => (
          <span key={wi} style={{
            position: "absolute",
            left: wi * 15,
            fontFamily: "var(--mono)", fontSize: "8px",
            color: "rgba(106,103,128,0.45)", letterSpacing: "0.05em",
          }}>
            {label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: "flex", gap: "3px", position: "relative" }}>
        {cols.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {week.map((day, di) => {
              const isToday = day.date.getTime() === today.getTime();
              const intensity = day.count > 0 ? Math.min(1, 0.25 + (day.count / maxCount) * 0.75) : 0;
              const dateStr = day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div
                  key={di}
                  onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, date: dateStr, count: day.count })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    width: 11, height: 11,
                    borderRadius: "2px",
                    background: day.count === 0
                      ? "rgba(255,255,255,0.04)"
                      : `rgba(123,108,255,${intensity})`,
                    border: isToday
                      ? "1px solid rgba(123,108,255,0.7)"
                      : "none",
                    boxShadow: day.count > 0
                      ? `0 0 ${3 + intensity * 7}px rgba(123,108,255,${intensity * 0.5})`
                      : "none",
                    cursor: "default",
                    transition: "transform 0.1s",
                  }}
                  onMouseOver={e => e.currentTarget.style.transform = "scale(1.4)"}
                  onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "fixed",
          left: tooltip.x + 12, top: tooltip.y - 36,
          background: "rgba(10,10,18,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px",
          padding: "5px 10px",
          pointerEvents: "none",
          zIndex: 999,
          display: "flex", gap: "6px", alignItems: "center",
        }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)" }}>{tooltip.date}</span>
          <span style={{ width: 1, height: 10, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: tooltip.count > 0 ? "var(--primary)" : "var(--muted)" }}>
            {tooltip.count} {tooltip.count === 1 ? "session" : "sessions"}
          </span>
        </div>
      )}
    </motion.div>
  );
}

function SessionCard({ session, onView, index }) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onView(session)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        background: hovered ? "rgba(123,108,255,0.05)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${hovered ? "rgba(123,108,255,0.28)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: "18px",
        padding: "22px 24px",
        display: "flex", gap: "18px", alignItems: "flex-start",
        cursor: "pointer",
        transition: "background 0.3s, border-color 0.3s",
        overflow: "hidden",
      }}
    >
      {hovered && (
        <div style={{
          position: "absolute", top: -60, left: -60,
          width: 200, height: 200, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123,108,255,0.1) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--ui)", fontSize: "19px", color: "var(--text)",
          lineHeight: 1.5, marginBottom: "6px",
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {session.situation}
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.05em" }}>
            {timeAgo(session.createdAt)}
          </span>
          <span style={{ width: 2, height: 2, borderRadius: "50%", background: "var(--muted)", opacity: 0.4 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.05em" }}>
            {Math.ceil((session.turnCount || 0) / 2)} exchanges
          </span>
        </div>
        {session.focus && (
          <div style={{
            marginTop: "10px",
            fontFamily: "var(--mono)", fontSize: "16px", color: "rgba(106,103,128,0.7)",
            lineHeight: 1.55, overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
          }}>
            {session.focus}
          </div>
        )}
      </div>

      <div style={{
        fontFamily: "var(--mono)", fontSize: "15px", color: "var(--primary)",
        letterSpacing: "0.05em", flexShrink: 0,
        opacity: hovered ? 1 : 0.5, transition: "opacity 0.2s",
      }}>
        →
      </div>
    </motion.div>
  );
}

// Dashboard's session list is a trimmed summary (no .history/.debrief) when it
// comes from GET /api/sessions, but a full record when it comes from the
// localStorage fallback (lib/localSessions.js). Fetch the full record on open
// only when it isn't already present, then render the CURRENT (non-scored)
// debrief shape — persona_impressions / communication_observations / focus /
// self_advocacy / question_breakdown — not the legacy scored fields.
function PastSessionModal({ session, onClose, getIdToken }) {
  const [full, setFull] = useState(Array.isArray(session?.history) ? session : null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!session || full) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        const data = await getJSON(`/api/sessions/${session.id}`, token);
        if (!cancelled) setFull(data);
      } catch (e) {
        console.error("[Dashboard] failed to load full session:", e);
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  if (!session) return null;
  const d = full?.debrief;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, backdropFilter: "blur(16px)", padding: "24px",
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.88, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        style={{
          background: "#0A0A10",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "24px", padding: "40px",
          maxWidth: "580px", width: "100%", maxHeight: "85vh",
          overflowY: "auto", scrollbarWidth: "none",
          display: "flex", flexDirection: "column", gap: "22px",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Header */}
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.15em", marginBottom: "10px" }}>
            {new Date(session.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </div>
          <div style={{ fontFamily: "var(--display)", fontSize: "23px", color: "var(--text)", lineHeight: 1.4 }}>
            {session.situation}
          </div>
        </div>

        <div style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />

        {!full && !loadFailed && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--muted)", letterSpacing: "0.1em" }}>
            LOADING…
          </div>
        )}
        {loadFailed && (
          <div style={{ fontFamily: "var(--ui)", fontSize: 18, color: "var(--muted)", lineHeight: 1.6 }}>
            Couldn't load the full debrief for this session. Your transcript may still be viewable below.
          </div>
        )}

        {d?.focus && (
          <div style={{ padding: "20px 22px", borderRadius: "14px", background: "rgba(123,108,255,0.05)", border: "1px solid rgba(123,108,255,0.15)" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--primary)", letterSpacing: "0.14em", marginBottom: "10px" }}>IF YOU PRACTICE ONE THING NEXT</div>
            <div style={{ fontFamily: "var(--display)", fontSize: "22px", lineHeight: 1.6 }}>{d.focus}</div>
          </div>
        )}

        {(d?.communication_observations || []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.14em" }}>COMMUNICATION OBSERVATIONS</div>
            {d.communication_observations.slice(0, 4).map((o, i) => (
              <div key={i} style={{ display: "flex", gap: "10px" }}>
                <span style={{ color: "var(--primary)", flexShrink: 0, opacity: 0.7 }}>→</span>
                <div style={{ fontFamily: "var(--ui)", fontSize: "18px", color: "var(--muted)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-2)", fontWeight: 500 }}>{o.dimension}:</strong> {o.observation}
                </div>
              </div>
            ))}
          </div>
        )}

        {(d?.persona_impressions || []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.14em" }}>PANEL IMPRESSIONS</div>
            {d.persona_impressions.map((imp, i) => (
              <div key={i} style={{ padding: "14px 16px", borderRadius: "12px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontFamily: "var(--display)", fontSize: "18px", color: "var(--text)", marginBottom: "4px" }}>{imp.persona}</div>
                <div style={{ fontFamily: "var(--ui)", fontSize: "17px", color: "var(--muted)", lineHeight: 1.6 }}>{imp.impression}</div>
              </div>
            ))}
          </div>
        )}

        {/* Transcript toggle */}
        {full?.history?.length > 0 && (
          <div>
            <button
              onClick={() => setShowTranscript(v => !v)}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px", padding: "12px 16px",
                fontFamily: "var(--mono)", fontSize: "15px",
                color: "var(--muted)", letterSpacing: "0.12em",
              }}
            >
              <span>TRANSCRIPT · {full.history.length} TURNS</span>
              <span style={{ opacity: 0.5 }}>{showTranscript ? "▲" : "▼"}</span>
            </button>
            <AnimatePresence>
              {showTranscript && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{
                    display: "flex", flexDirection: "column", gap: "12px",
                    marginTop: "10px", maxHeight: "260px", overflowY: "auto", scrollbarWidth: "none",
                  }}>
                    {full.history.map((turn, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: turn.speaker === "You" ? "var(--amber)" : "var(--teal)", letterSpacing: "0.08em" }}>
                          {turn.speaker.toUpperCase()}
                        </span>
                        <span style={{ fontFamily: "var(--ui)", fontSize: "18px", color: "var(--muted)", lineHeight: 1.6 }}>
                          {turn.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button onClick={onClose} className="btn btn-ghost" style={{ width: "100%", marginTop: "4px" }}>
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}

export default function Dashboard({ user, onNewSession, onOpenProgress, getIdToken }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    if (!user?.sub) { setLoading(false); return; }
    // Show local sessions instantly while we fetch from server
    setSessions(getLocalSessions(user.sub));
    const load = async () => {
      try {
        const token = await getIdToken();
        const data = await getJSON("/api/sessions", token);
        if (data?.length) setSessions(data);
      } catch {
        // backend unavailable — local sessions already shown
      }
      setLoading(false);
    };
    load();
  }, [user, getIdToken]);

  const firstName = user?.given_name || user?.name?.split(" ")[0] || "there";

  return (
    <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--bg)" }}
    >
      <div className="ambient" />
      <div className="noise" />

      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage:
          "linear-gradient(rgba(123,108,255,0.018) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(123,108,255,0.018) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        maskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 30%, transparent 100%)",
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: "700px", margin: "0 auto", width: "100%",
        padding: "56px 24px 100px",
        display: "flex", flexDirection: "column", gap: "24px",
      }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <img src="/logo.png" alt="Swarm AI logo" width={34} height={34} style={{ display: "block" }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: "16px", color: "var(--muted)", letterSpacing: "0.3em" }}>SWARM AI</span>
            </div>
            <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(42px, 6.5vw, 64px)", fontWeight: 300, lineHeight: 1.15 }}>
              Welcome back,<br />
              <em style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7B6CFF 0%, #00D9FF 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>{firstName}</em>
            </h1>
          </div>
          {user?.picture && (
            <img
              src={user.picture} alt="" width={48} height={48}
              referrerPolicy="no-referrer"
              style={{
                borderRadius: "50%",
                border: "1px solid rgba(123,108,255,0.3)",
                boxShadow: "0 0 20px rgba(123,108,255,0.15)",
                flexShrink: 0,
              }}
            />
          )}
        </motion.div>

        {/* Sessions count — no streaks, no daily-login pressure, no loss framing.
            Per-metric trends live in the Progress view instead. */}
        {!loading && sessions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            style={{
              padding: "14px 16px",
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "14px",
              backdropFilter: "blur(12px)",
              position: "relative", overflow: "hidden",
            }}
          >
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 60%)",
              borderRadius: "14px", pointerEvents: "none",
            }} />
            <div style={{ fontFamily: "var(--display)", fontSize: "32px", color: "var(--primary)", lineHeight: 1, marginBottom: "4px" }}>{sessions.length}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.12em" }}>SESSIONS</div>
          </motion.div>
        )}

        {/* Practice heatmap */}
        {!loading && sessions.length > 0 && <PracticeHeatmap sessions={sessions} />}

        {/* Progress view entry point */}
        {!loading && sessions.length > 0 && onOpenProgress && (
          <motion.button
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14, duration: 0.5 }}
            whileHover={{ y: -2 }}
            onClick={onOpenProgress}
            className="card"
            style={{
              padding: "18px 22px", cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              borderTop: "2px solid var(--calm)", background: "rgba(116,185,160,0.04)",
            }}
          >
            <div>
              <div style={{ fontFamily: "var(--display)", fontSize: 20, color: "var(--text)" }}>View your progress</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--muted)", letterSpacing: "0.06em", marginTop: 4 }}>
                Trends over time, current focus area, and what you've built up
              </div>
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--calm)" }}>→</span>
          </motion.button>
        )}

        {/* New session CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.55 }}
        >
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            className="btn btn-primary"
            onClick={onNewSession}
            style={{
              width: "100%", height: "auto",
              padding: "26px 28px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderRadius: "20px",
              fontSize: "20px",
              position: "relative", overflow: "hidden",
            }}
          >
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.06) 75%, transparent 75%)",
              backgroundSize: "40px 40px",
              opacity: 0.3,
            }} />
            {/* Shine on top edge */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0,
              height: "1px",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
            }} />
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "5px" }}>
              <span style={{ fontFamily: "var(--display)", fontSize: "23px", fontWeight: 400 }}>Launch New Session</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: "16px", opacity: 0.6, fontWeight: 400, letterSpacing: "0.06em" }}>
                5 AI agents · live voice · adaptive debrief
              </span>
            </div>
            <div style={{
              position: "relative",
              width: 44, height: 44, borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "24px",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.12) inset",
            }}>→</div>
          </motion.button>
        </motion.div>

        {/* Past sessions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "rgba(106,103,128,0.5)", letterSpacing: "0.18em" }}>
              {loading ? "LOADING..." : sessions.length > 0 ? `PAST SESSIONS (${sessions.length})` : "NO SESSIONS YET"}
            </span>
          </div>

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {[1, 2, 3].map(i => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }}
                  style={{
                    height: "90px", borderRadius: "18px",
                    background: "rgba(255,255,255,0.025)",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                />
              ))}
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{
                padding: "60px 24px", borderRadius: "20px",
                background: "rgba(255,255,255,0.018)",
                border: "1px dashed rgba(255,255,255,0.07)",
                textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px",
              }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(123,108,255,0.08)",
                border: "1px solid rgba(123,108,255,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "23px", color: "var(--primary)",
              }}>◎</div>
              <div style={{ fontFamily: "var(--display)", fontSize: "23px", color: "var(--text-2)" }}>No sessions yet</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "16px", color: "rgba(106,103,128,0.5)", maxWidth: "280px", lineHeight: 1.65 }}>
                Complete your first practice to see your performance history here.
              </div>
            </motion.div>
          )}

          {!loading && sessions.map((s, i) => (
            <SessionCard key={s.id} session={s} onView={setViewing} index={i} />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {viewing && <PastSessionModal session={viewing} onClose={() => setViewing(null)} getIdToken={getIdToken} />}
      </AnimatePresence>
    </motion.div>
  );
}
