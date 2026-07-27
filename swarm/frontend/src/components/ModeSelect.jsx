import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getJSON } from "../lib/api";

const sv = {
  initial: { opacity: 0, filter: "blur(10px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, filter: "blur(8px)", transition: { duration: 0.3 } },
};

// "peer" isn't part of the backend module registry (it's a wholly different,
// non-LLM Jitsi surface — see backend/modules/index.js) so it's always added
// here as a fixed fourth tile. Accent colors + titles for known module keys;
// any module the backend adds without a preset here still renders (fallback
// accent/title below), so shipping a new module never requires a frontend change.
const STATIC_MODES = [
  { key: "peer", accent: "#8FB6E8", title: "Person" },
];
const PRESET = {
  interview: { accent: "var(--honey)", title: "Interview" },
  conversation: { accent: "var(--calm)", title: "Casual" },
  networking: { accent: "#B39BD8", title: "Networking" },
  college_interview: { accent: "var(--honey)", title: "College Interview" },
  group_discussion: { accent: "#D98B8B", title: "Group Discussion" },
};

export default function ModeSelect({ onSelect, onBack, getIdToken }) {
  const [modules, setModules] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken?.();
        const res = await getJSON("/api/modules", token);
        if (!cancelled) setModules(Array.isArray(res?.modules) ? res.modules : []);
      } catch (e) {
        console.error("[ModeSelect] failed to load modules, using defaults:", e);
        if (!cancelled) setModules([{ key: "interview", label: "Interview", implemented: true }, { key: "conversation", label: "Casual", implemented: true }]);
      }
    })();
    return () => { cancelled = true; };
  }, [getIdToken]);

  const MODES = [
    ...(modules || []).map(m => ({
      key: m.key,
      accent: PRESET[m.key]?.accent || "var(--dim)",
      title: PRESET[m.key]?.title || m.label,
      implemented: m.implemented !== false,
    })),
    ...STATIC_MODES.map(m => ({ ...m, implemented: true })),
  ];
  return (
    <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--ink)" }}>
      <div className="ambient" />
      <div className="noise" />

      <div style={{
        position: "relative", zIndex: 1, minHeight: "100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "72px 32px 40px", maxWidth: 1280, margin: "0 auto", gap: 40, width: "100%",
      }}>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}
          style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: "clamp(52px, 8vw, 88px)", lineHeight: 1.1, textAlign: "center" }}>
          Practice.
        </motion.h1>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20, width: "100%", flex: 1, maxHeight: 560,
        }}>
          {MODES.map((m, i) => (
            <motion.button
              key={m.key}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              whileHover={m.implemented ? { y: -6, scale: 1.01 } : {}}
              whileTap={m.implemented ? { scale: 0.99 } : {}}
              onClick={() => m.implemented && onSelect(m.key)}
              disabled={!m.implemented}
              className="card"
              style={{
                padding: "24px", cursor: m.implemented ? "pointer" : "default",
                minHeight: "min(48vh, 460px)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
                borderTop: `4px solid ${m.accent}`,
                background: "var(--surface)",
                opacity: m.implemented ? 1 : 0.45,
              }}
            >
              <span style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: "clamp(40px, 4.5vw, 62px)", color: "var(--text)" }}>
                {m.title}
              </span>
              {!m.implemented && (
                <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", letterSpacing: "0.12em" }}>
                  COMING SOON
                </span>
              )}
            </motion.button>
          ))}
        </div>

        <button className="btn btn-ghost" onClick={onBack} style={{ fontSize: 18 }}>
          Back
        </button>
      </div>
    </motion.div>
  );
}
