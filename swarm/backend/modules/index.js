// Registry of pluggable practice-context configs. Each module is a plain
// config object (system prompt fragment, question bank tags, persona count,
// session length, relevant metrics) — adding a module means adding a file
// here, not touching the session engine (architect.js / judgeOrchestrator.js
// / personaGenerator.js consult these flags instead of hardcoded mode checks).
import interview from "./interview.js";
import conversation from "./conversation.js";
import networking from "./networking.js";
import collegeInterview from "./collegeInterview.js";
import groupDiscussion from "./groupDiscussion.js";

// "peer" (Jitsi, two real humans, no LLM turn orchestration, no
// sessionData/personas/plan) is intentionally NOT registered here — it's a
// different surface entirely (routes/peer.js, lib/peerQueue.js,
// lib/videoRoom.js, frontend PeerSession.jsx) that bypasses this engine
// completely. Forcing it into this config shape would be fiction.
const MODULES = {
  interview,
  conversation,
  networking,
  college_interview: collegeInterview,
  group_discussion: groupDiscussion,
};

export function getModule(key) {
  return MODULES[key] || MODULES.interview;
}

export function listModules() {
  return Object.values(MODULES).map(m => ({
    key: m.key,
    label: m.label,
    implemented: m.implemented,
    evaluative: m.evaluative,
    skipResearch: m.skipResearch,
  }));
}
