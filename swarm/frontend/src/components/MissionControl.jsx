import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { streamFetch } from "../lib/api";
import SnakeGame from "./SnakeGame";

const AGENTS = [
  { name: "Researcher",     color: "#8FB6E8", label: "Researcher",    icon: "◎" },
  { name: "Profiler",       color: "#74B9A0", label: "Profiler",       icon: "◉" },
  { name: "WeakSpotFinder", color: "#B39BD8", label: "Focus Areas",    icon: "◈" },
  { name: "VoiceDesigner",  color: "#D98B8B", label: "Voice Designer", icon: "◐" },
  { name: "Architect",      color: "#E4A339", label: "Architect",      icon: "◑" },
];

const PHASE = {
  0:   "Starting up...",
  20:  "Researching your scenario...",
  40:  "Understanding your panel...",
  60:  "Choosing focus areas...",
  80:  "Matching voices...",
  100: "Your panel is ready.",
};

function phaseLabel(p) {
  return PHASE[[100, 80, 60, 40, 20, 0].find(k => p >= k)] ?? "Architecting...";
}

const sv = {
  initial: { opacity: 0, scale: 0.97, filter: "blur(10px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, scale: 1.02, filter: "blur(8px)", transition: { duration: 0.4 } },
};

/* ── Agent orb with animated rings ── */
function AgentOrb({ agent, state }) {
  const isActive = state === "active";
  const isDone = state === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Outer pulse ring */}
        {isActive && (
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{
              position: "absolute",
              width: 70, height: 70, borderRadius: "50%",
              border: `1px solid ${agent.color}`,
              pointerEvents: "none",
            }}
          />
        )}
        {/* Mid ring */}
        {(isActive || isDone) && (
          <motion.div
            animate={isActive ? { scale: [1, 1.2, 1], opacity: [0.6, 0.2, 0.6] } : {}}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
            style={{
              position: "absolute",
              width: 54, height: 54, borderRadius: "50%",
              border: `1px solid ${agent.color}55`,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Core orb */}
        <motion.div
          animate={{
            width: isActive ? 44 : 36,
            height: isActive ? 44 : 36,
            boxShadow: isDone
              ? `0 0 20px ${agent.color}44, 0 0 40px ${agent.color}18`
              : isActive
              ? `0 0 30px ${agent.color}66, 0 0 60px ${agent.color}22`
              : "none",
          }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          style={{
            borderRadius: "50%",
            background:
              state === "idle" || state === "waiting"
                ? "rgba(255,255,255,0.04)"
                : `radial-gradient(circle at 35% 30%, ${agent.color}ff 0%, ${agent.color}55 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "20px",
            border: `1px solid ${state === "idle" || state === "waiting" ? "rgba(255,255,255,0.06)" : `${agent.color}44`}`,
            transition: "background 0.4s",
          }}
        >
          <span style={{
            color: state === "idle" || state === "waiting" ? "rgba(255,255,255,0.15)" : "white",
            fontSize: "18px",
          }}>
            {agent.icon}
          </span>
        </motion.div>
      </div>

      <div style={{
        fontFamily: "var(--mono)", fontSize: "15px",
        color: isDone ? agent.color : "var(--muted)",
        letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "center",
        transition: "color 0.4s",
      }}>
        {agent.label}
      </div>
      <div style={{
        fontFamily: "var(--mono)", fontSize: "15px",
        color: isDone ? "var(--success)" : isActive ? agent.color : "rgba(106,103,128,0.4)",
        transition: "color 0.4s",
      }}>
        {isDone ? "✓" : isActive ? "●" : state === "waiting" ? "…" : "○"}
      </div>
    </div>
  );
}

export default function MissionControl({ situation, intent = null, mode = "interview", moduleInfo = null, tone = "neutral", supportLevel = "guided", onBeginSession, getIdToken }) {
  // moduleInfo comes from GET /api/modules (fetched once in App.jsx) — falls
  // back to the old hardcoded check if it hasn't loaded yet.
  const skipsResearch = moduleInfo ? !!moduleInfo.skipResearch : mode === "conversation";
  const [outputs, setOutputs] = useState({});
  const [done, setDone] = useState({});
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState(null);
  const cardRefs = useRef({});
  // Chronological terminal log: [{ agent, color, text }]
  const [log, setLog] = useState([]);
  const terminalRef = useRef(null);

  // Pause the visible stream: the work continues underneath, but the display
  // holds perfectly still so it can be read at the user's own pace.
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(null);
  const togglePause = () => {
    setFrozen(paused ? null : { outputs, done, log });
    setPaused(p => !p);
  };
  const viewOutputs = paused && frozen ? frozen.outputs : outputs;
  const viewDone = paused && frozen ? frozen.done : done;
  const viewLog = paused && frozen ? frozen.log : log;

  const agentColor = (name) => AGENTS.find(a => a.name === name)?.color || "var(--dim)";
  const agentLabel = (name) => AGENTS.find(a => a.name === name)?.label || name;

  const pushLogLine = (agent, text) =>
    setLog(prev => [...prev.slice(-120), { agent, text }]);
  const appendLogLine = (agent, text) =>
    setLog(prev => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].agent === agent) {
          next[i] = { ...next[i], text: next[i].text + text };
          return next;
        }
      }
      return [...next.slice(-120), { agent, text }];
    });

  useEffect(() => {
    const controller = new AbortController();

    const start = async () => {
      setOutputs({});
      setDone({});
      setSessionData(null);
      setError(null);

      try {
        const token = await getIdToken();
        await streamFetch("/api/start-session", { situation, intent, mode, tone, supportLevel }, chunk => {
          if (controller.signal.aborted) return;
          if (chunk.heartbeat) return;
          if (chunk.error) { setError(chunk.error); return; }
          if (!chunk.agent) return;
          if (chunk.thinking) {
            setOutputs(p => ({ ...p, [chunk.agent]: chunk.chunk }));
            pushLogLine(chunk.agent, chunk.chunk);
            return;
          }
          if (chunk.streamStart) {
            setOutputs(p => ({ ...p, [chunk.agent]: chunk.chunk }));
            pushLogLine(chunk.agent, chunk.chunk);
            return;
          }
          if (chunk.chunk) {
            setOutputs(p => ({ ...p, [chunk.agent]: (p[chunk.agent] || "") + chunk.chunk }));
            appendLogLine(chunk.agent, chunk.chunk);
          }
          if (chunk.done) {
            setDone(p => ({ ...p, [chunk.agent]: true }));
            pushLogLine(chunk.agent, "Done.");
            if (chunk.sessionData) setSessionData(chunk.sessionData);
          }
        }, token, controller.signal);
      } catch (e) {
        if (e.name === "AbortError") return;
        setError(e.message || "Connection failed. Please try again.");
      } finally {
        controller.abort(); // always clean up signal on exit
      }
    };

    start();
    return () => controller.abort();
  }, [situation, intent, mode, tone, supportLevel, getIdToken]);

  useEffect(() => {
    if (paused) return; // no auto-scroll while reading
    Object.values(cardRefs.current).forEach(el => { if (el) el.scrollTop = el.scrollHeight; });
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [outputs, log, paused]);

  const doneCount = Object.keys(viewDone).length;
  const activeCount = AGENTS.filter(a => viewOutputs[a.name]?.length > 0 && !viewDone[a.name]).length;
  const progress = Math.min(((doneCount + activeCount * 0.5) / 5) * 100, 99);
  // allDone follows LIVE state so the begin button appears even while paused
  const allDone = Object.keys(done).length === 5;

  const getState = (name) => {
    if (viewDone[name]) return "done";
    if (viewOutputs[name]?.length > 0) return "active";
    if (name === "Architect" && doneCount < 4) return "waiting";
    return "idle";
  };

  // ── Modules that skip research: one calm setup moment, no agent theater ────
  if (skipsResearch) {
    return (
      <motion.div className="screen" variants={sv} initial="initial" animate="animate" exit="exit"
        style={{ background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="noise" />
        <div style={{
          position: "relative", zIndex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", gap: 22, padding: "0 24px", textAlign: "center", maxWidth: 440,
        }}>
          <motion.div
            animate={sessionData ? { scale: 1, opacity: 1 } : { scale: [1, 1.07, 1], opacity: [0.55, 0.9, 0.55] }}
            transition={sessionData ? { duration: 0.4 } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: 72, height: 72, borderRadius: "50%",
              border: "2px solid var(--calm)", background: "var(--calm-soft)",
            }}
          />
          <div style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: 30 }}>
            {sessionData ? "Your conversation partner is ready." : "Setting things up…"}
          </div>
          <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, color: "var(--dim)", lineHeight: 1.7 }}>
            {sessionData
              ? `You'll be chatting with ${sessionData.personas?.[0]?.name || "a friendly partner"} (a fictional AI, not a real person). Take your time, end whenever you like.`
              : "Just a moment. This is a relaxed space: no question list, no evaluation."}
          </p>
          {error && (
            <div style={{
              padding: "12px 16px", borderRadius: 10, background: "rgba(217,139,139,0.07)",
              border: "1px solid rgba(217,139,139,0.25)", fontFamily: "var(--ui)", fontSize: 18, color: "var(--alert)",
            }}>{error}</div>
          )}
          {sessionData && (
            <motion.button
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="btn btn-primary"
              onClick={() => onBeginSession(sessionData)}
              style={{ padding: "0 32px", fontSize: 19 }}
            >
              Say hello
            </motion.button>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--bg)" }}
    >
      <div className="ambient" />
      <div className="noise" />

      {/* Grid */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
        backgroundSize: "52px 52px",
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        minHeight: "100%", display: "flex", flexDirection: "column",
        padding: "28px 28px 24px",
        maxWidth: "1000px", margin: "0 auto", width: "100%", gap: "18px",
      }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.2em", marginBottom: "8px" }}>
              PHASE 2 OF 4
            </div>
            <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 400, lineHeight: 1.2, marginBottom: "6px" }}>
              Building your panel.
            </h1>
            <div style={{
              fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)",
              maxWidth: "420px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              letterSpacing: "0.03em",
            }}>
              {situation}
            </div>
          </div>

          <motion.div
            animate={{ opacity: 1 }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: allDone ? "var(--calm-soft)" : "var(--honey-soft)",
              border: `1px solid ${allDone ? "rgba(116,185,160,0.3)" : "rgba(228,163,57,0.3)"}`,
              borderRadius: "999px", padding: "7px 16px",
              transition: "all 0.5s",
            }}
          >
            <span className="dot" style={{
              background: allDone ? "var(--success)" : "var(--primary)",
              animation: allDone ? "none" : undefined,
            }} />
            <span style={{
              fontFamily: "var(--mono)", fontSize: "15px",
              color: allDone ? "var(--success)" : "var(--primary)",
              letterSpacing: "0.08em",
            }}>
              {allDone ? "COMPLETE" : "SWARM ACTIVE"}
            </span>
          </motion.div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{
                padding: "14px 18px", borderRadius: "12px",
                background: "rgba(255,107,107,0.07)", border: "1px solid rgba(255,107,107,0.18)",
                fontFamily: "var(--mono)", fontSize: "16px", color: "var(--coral)",
              }}
            >
              Error: {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Agent orbs */}
        <div style={{
          display: "flex", justifyContent: "center",
          gap: "clamp(26px, 4.5vw, 62px)",
          padding: "12px 0",
        }}>
          {AGENTS.map((a) => (
            <AgentOrb key={a.name} agent={a} state={getState(a.name)} />
          ))}
        </div>

        {/* Connection line */}
        <div style={{
          position: "relative", height: "1px",
          background: "rgba(255,255,255,0.04)",
          marginTop: "-6px",
        }}>
          <motion.div
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            style={{
              height: "100%",
              background: "linear-gradient(90deg, #74B9A0, #E4A339)",
              boxShadow: "0 0 8px rgba(228,163,57,0.35)",
            }}
          />
        </div>

        {/* Live terminal output — one box, explicit pause, reads at your pace */}
        <div style={{
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: "var(--radius)", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 18px", borderBottom: "1px solid var(--line)", gap: 12,
          }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", letterSpacing: "0.14em" }}>
              LIVE TERMINAL OUTPUT
            </span>
            <button
              onClick={togglePause}
              aria-pressed={paused}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "7px 16px", borderRadius: 999, cursor: "pointer",
                background: paused ? "var(--calm-soft)" : "var(--raised)",
                border: `1px solid ${paused ? "rgba(116,185,160,0.45)" : "var(--line)"}`,
                fontFamily: "var(--ui)", fontSize: 15, fontWeight: 500,
                color: paused ? "var(--calm)" : "var(--dim)",
                transition: "all 0.2s",
              }}
            >
              {paused ? "▶ Resume stream" : "⏸ Pause stream"}
            </button>
          </div>
          <div ref={terminalRef} style={{
            height: 190, overflowY: "auto", padding: "14px 18px",
            background: "var(--ink)",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {viewLog.length === 0 && (
              <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", opacity: 0.6 }}>
                {">"} Starting up...
              </span>
            )}
            {viewLog.map((line, i) => (
              <div key={i} style={{ fontFamily: "var(--mono)", fontSize: 15, lineHeight: 1.6, wordBreak: "break-word" }}>
                <span style={{ color: agentColor(line.agent) }}>{">"} {agentLabel(line.agent)}:</span>{" "}
                <span style={{ color: "var(--text-2)" }}>{line.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Progress bar + launch */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", letterSpacing: "0.06em" }}>
              {phaseLabel(progress)}
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: "16px", color: "var(--primary)", letterSpacing: "0.04em" }}>
              {Math.round(progress)}%
            </span>
          </div>

          <div style={{
            height: "3px", borderRadius: "2px",
            background: "rgba(255,255,255,0.04)",
            position: "relative", overflow: "hidden",
          }}>
            <motion.div
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              style={{
                height: "100%", borderRadius: "2px",
                background: "linear-gradient(90deg, #74B9A0, #E4A339)",
                backgroundSize: "200% 100%",
                animation: "gradientShift 3s ease infinite",
              }}
            />
            {!allDone && (
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                animation: "shimmer 2s ease-in-out infinite",
              }} />
            )}
          </div>

          <AnimatePresence>
            {allDone && (
              <motion.button
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                className="btn btn-primary"
                onClick={() => onBeginSession(sessionData)}
                style={{ width: "100%" }}
              >
                Meet your panel
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Something to do while the swarm works */}
        <AnimatePresence>
          {!allDone && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              style={{ display: "flex", justifyContent: "center", paddingBottom: 24 }}
            >
              <SnakeGame />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
