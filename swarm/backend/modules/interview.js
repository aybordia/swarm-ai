export default {
  key: "interview",
  label: "Interview",
  usesQuestionBank: true,
  questionBankTags: null, // domain comes from parsed intent
  personaCount: { min: 1, max: 5 },
  sessionLengthMinutes: null, // derived from question count
  evaluative: true,
  skipResearch: false,
  systemPromptFragment: "",
  relevantMetrics: [
    "avg_speaking_pace_wpm", "avg_response_latency_sec", "filler_word_rate",
    "answer_length_avg_sec", "interruption_count", "answer_structure_score",
  ],
  branchingEnabled: true,
  implemented: true,
};
