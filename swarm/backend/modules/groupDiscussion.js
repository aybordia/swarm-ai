// Scaffold only — see collegeInterview.js. implemented:false gates it out of
// ModeSelect until a real multi-participant discussion flow is built.
export default {
  key: "group_discussion",
  label: "Group Discussion",
  usesQuestionBank: true,
  questionBankTags: { domain: "general" },
  personaCount: { min: 2, max: 4 },
  sessionLengthMinutes: 20,
  evaluative: false,
  skipResearch: true,
  systemPromptFragment: "Purpose: a multi-person group discussion practice scenario.",
  relevantMetrics: ["avg_speaking_pace_wpm", "interruption_count"],
  branchingEnabled: false,
  implemented: false,
};
