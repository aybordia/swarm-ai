// Scaffold only — registered so the module list/UI can show it, not yet
// wired to any interview-specific prompt tuning beyond the shared interview
// engine. implemented:false gates it out of ModeSelect until it is.
export default {
  key: "college_interview",
  label: "College Interview",
  usesQuestionBank: true,
  questionBankTags: { domain: "general" },
  personaCount: { min: 1, max: 2 },
  sessionLengthMinutes: null,
  evaluative: true,
  skipResearch: false,
  systemPromptFragment: "Purpose: a college admissions interview — behavioral and motivational questions, no technical domain questions.",
  relevantMetrics: ["avg_response_latency_sec", "answer_length_avg_sec", "answer_structure_score"],
  branchingEnabled: true,
  implemented: false,
};
