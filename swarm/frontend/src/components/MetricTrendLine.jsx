import { motion } from "framer-motion";

// Generalized version of the old score-specific TrendGraph — a plain sparkline
// for any communication-profile metric, with a plain-language delta sentence
// underneath (no grades, no percentages, no leaderboards — see Feature 2).
export default function MetricTrendLine({ label, unit = "", history = [], accent = "var(--calm)" }) {
  const points = (history || []).filter(h => Number.isFinite(h.value)).slice(-8);
  if (points.length < 2) return null;

  const W = 560, H = 120;
  const PAD = { top: 14, right: 16, bottom: 14, left: 16 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const values = points.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;

  const xOf = i => PAD.left + (i / (points.length - 1)) * innerW;
  const yOf = v => PAD.top + innerH * (1 - (v - min) / range);
  const pts = points.map((p, i) => ({ x: xOf(i), y: yOf(p.value) }));

  const linePath = pts.map((pt, i) => {
    if (i === 0) return `M${pt.x},${pt.y}`;
    const prev = pts[i - 1];
    const cpx = (prev.x + pt.x) / 2;
    return `C${cpx},${prev.y} ${cpx},${pt.y} ${pt.x},${pt.y}`;
  }).join(" ");

  const from = points[0].value, to = points[points.length - 1].value;
  const direction = to < from ? "decreased" : to > from ? "increased" : "stayed steady";
  const range_ = direction === "stayed steady" ? `around ${to}${unit}` : `from ${from}${unit} to ${to}${unit}`;
  const trendText = `${label} has ${direction} ${range_} over ${points.length} sessions.`;

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", letterSpacing: "0.14em" }}>
        {label.toUpperCase()}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <motion.path
          d={linePath} fill="none" stroke={accent} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
        {pts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r="3.5" fill={accent} />
        ))}
      </svg>
      <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 17, lineHeight: 1.6, color: "var(--text-2)" }}>
        {trendText}
      </p>
    </div>
  );
}
