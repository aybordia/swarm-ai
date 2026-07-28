// Splits a saved transcript into per-planned-question segments, using the
// questionIndex/isAdvancing tags the client attaches to each AI turn (see
// frontend VoiceSession.jsx, and agents/judgeOrchestrator.js which derives
// its own follow-up state the same way). Used by the teaching debrief
// (routes/debrief.js) to hand the LLM one clean block per question instead
// of re-deriving question boundaries from scratch.
export function segmentTranscriptByQuestion(fullTranscript = [], sessionPlan = null) {
  const questions = sessionPlan?.questions || [];
  const segments = [];
  let current = null;

  for (const turn of fullTranscript) {
    const isAI = turn.speaker !== "You" && turn.speaker !== "User";
    if (isAI && Number.isFinite(turn.questionIndex)) {
      if (!current || turn.isAdvancing || turn.questionIndex !== current.index) {
        current = { index: turn.questionIndex, question: questions[turn.questionIndex] || null, turns: [] };
        segments.push(current);
      }
    }
    if (current) current.turns.push(turn);
  }

  // Fallback for transcripts with no questionIndex tags — free-flow,
  // non-evaluative drills (conversation, networking, …) don't march through a
  // fixed plan, so there's nothing to tag turns with. Treat each AI turn as
  // opening one exchange, collecting the user turns that follow it.
  if (!segments.length) {
    current = null;
    let index = -1;
    for (const turn of fullTranscript) {
      const isAI = turn.speaker !== "You" && turn.speaker !== "User";
      if (isAI) {
        index += 1;
        current = { index, question: null, turns: [] };
        segments.push(current);
      }
      if (current) current.turns.push(turn);
    }
  }

  return segments.map(seg => ({
    index: seg.index,
    question: seg.question?.text || seg.turns.find(t => t.speaker !== "You" && t.speaker !== "User")?.text || "",
    type: seg.question?.type || null,
    user_answer_transcript: seg.turns
      .filter(t => t.speaker === "You" || t.speaker === "User")
      .map(t => t.text)
      .join(" "),
  }));
}
