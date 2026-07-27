export default {
  key: "networking",
  label: "Networking",
  usesQuestionBank: true, // reuses the existing general/behavioral pool as loose conversation topics
  questionBankTags: { domain: "general" },
  personaCount: { min: 1, max: 1 },
  partnerTitle: "Networking contact",
  sessionLengthMinutes: 10,
  evaluative: false,
  skipResearch: true,
  systemPromptFragment: `Purpose: networking conversation practice (e.g. a career fair, an informational chat, a professional meetup). NOT an interviewer, NOT evaluative — but more purposeful than pure small talk, with a light professional angle. Invent a friendly, approachable fictional professional (title like "Person you're networking with"), with a warm personality_style and question_focus "mixed".`,
  relevantMetrics: ["avg_speaking_pace_wpm", "filler_word_rate", "answer_length_avg_sec"],
  branchingEnabled: false,
  implemented: true,
};
