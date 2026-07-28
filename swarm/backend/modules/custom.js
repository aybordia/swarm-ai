// Backs the Coach's free-form box (Feature 1): the user describes what they
// actually need in their own words, and this module tells the persona
// generator to build a fictional partner that fits THAT specific situation,
// rather than any one fixed scenario.
export default {
  key: "custom",
  label: "Custom",
  usesQuestionBank: false,
  questionBankTags: null,
  personaCount: { min: 1, max: 1 },
  partnerTitle: "Practice partner",
  sessionLengthMinutes: 7,
  evaluative: false,
  skipResearch: true,
  systemPromptFragment: `Purpose: a flexible practice partner for whatever specific situation the user described in their own words below. NOT an interviewer, NOT evaluative. Read the user's own words carefully and invent a fictional person who would realistically be the other party in that exact situation (e.g. a doctor's appointment → a doctor or receptionist; a workplace conversation → a coworker or manager; a phone call → whoever they'd actually be calling). Give them a plausible title for that specific role and a personality_style that fits it, question_focus "mixed".`,
  relevantMetrics: ["avg_speaking_pace_wpm", "avg_response_latency_sec", "filler_word_rate", "answer_length_avg_sec"],
  branchingEnabled: false,
  implemented: true,
};
