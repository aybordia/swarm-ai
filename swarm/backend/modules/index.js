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
import explainingComplex from "./explainingComplex.js";
import askingForWhatYouNeed from "./askingForWhatYouNeed.js";
import difficultConversation from "./difficultConversation.js";
import phoneAndAppointment from "./phoneAndAppointment.js";
import presentingAnIdea from "./presentingAnIdea.js";
import smallTalkAndOpenings from "./smallTalkAndOpenings.js";
import custom from "./custom.js";

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
  explaining_something_complex: explainingComplex,
  asking_for_what_you_need: askingForWhatYouNeed,
  difficult_conversation: difficultConversation,
  phone_and_appointment: phoneAndAppointment,
  presenting_an_idea: presentingAnIdea,
  small_talk_and_openings: smallTalkAndOpenings,
  custom,
};

export function getModule(key) {
  return MODULES[key] || MODULES.interview;
}

export function listModules() {
  // Includes `custom` so the frontend's generic moduleMeta lookup (used by
  // MissionControl/SituationInput for ANY mode, not just ones picked from a
  // tile) resolves correctly for Coach's free-form launches too. `custom`
  // is filtered out of the drill-library tile grid client-side instead
  // (ModeSelect.jsx) — it's not something a user picks from a list, only a
  // target Coach's free-form box routes into.
  return Object.values(MODULES).map(m => ({
    key: m.key,
    label: m.label,
    implemented: m.implemented,
    evaluative: m.evaluative,
    skipResearch: m.skipResearch,
  }));
}
