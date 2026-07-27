// Debrief v2 — private, post-session, non-scored.
// Aggregates: full transcript + per-persona LLM impressions (constructive
// observations, never pass/fail) + neutral tracking-signal summaries.
// Signal categories render only if the user opted in (user_selected_categories).
import { callLLM, parseJSON } from "../lib/llm.js";
import { summarizeSignals } from "../lib/signalSummary.js";
import { getAsdProfile, buildAsdProfileHint } from "../lib/prefsStore.js";
import { TRACKING_SYSTEM_RULES } from "../lib/observationRules.js";
import { getModule } from "../modules/index.js";
import { segmentTranscriptByQuestion } from "../lib/questionSegments.js";

const IMPRESSIONS_PROMPT = `You write post-interview impressions from FICTIONAL simulated interviewers for a private practice debrief. The candidate is autistic; this tool exists specifically for autistic (ASD) candidates, and every impression must be written with that in mind.
Return ONLY valid JSON: {"impressions":[{"persona":"<name>","impression":"..."}]}

Rules for every impression:
- Written in that persona's voice, consistent with their described style.
- LITERAL, DIRECT language only: no idioms, no metaphors, no sarcasm, no vague hedging like "maybe consider possibly". Say exactly what you mean in plain words.
- 2-4 sentences: what stood out in the CONTENT of the candidate's answers (specific — quote or reference actual things they said), then at most one optional, concrete suggestion. Suggestions target answer content and structure only (e.g. "add the concrete example you mentioned earlier").
- Name autistic strengths explicitly when they appear in the transcript: precision, detailed knowledge, honesty, direct answers, deep interest in the subject. These are real interview advantages — say so plainly.
- Constructive and private. NEVER a score, grade, ranking, or pass/fail judgment.
${TRACKING_SYSTEM_RULES}
- If the candidate asked a clarifying question at any point, mention it positively and explicitly: asking for clarification is a strong interview skill and a valid accommodation.`;

// Research-grounded per-dimension analysis (pragmatic-communication +
// adapted-interview literature): separate dimensions, never collapsed into
// one judgment, so the user knows exactly WHAT to work on and what's already strong.
const OBSERVATIONS_PROMPT = `You analyze a mock-interview transcript across specific communication dimensions for a private debrief. The candidate is autistic — this tool exists specifically for autistic (ASD) candidates. Differences are not deficits; only functional communication gaps matter. All feedback uses literal, direct, concrete language: no idioms, no metaphors, no vague hedging.
Return ONLY valid JSON, fields in this exact order:
{"focus":"...","self_advocacy":["...","..."],"observations":[{"dimension":"...","observation":"...","suggestion":"..."}],"answer_structure_score":"needs_support|developing|strong"}
This debrief is NEVER scored or graded: no numbers, no ratings, no percentages, no pass/fail, anywhere. Only qualitative observations that name what was strong and what to try next.
"answer_structure_score" is a category label, not a grade — it is never shown to the candidate as a score; it only drives which practice area gets proposed next. Base it purely on structural completeness (did answers include situation/role/action/outcome, concrete examples, enough context for a listener?), never on delivery or pacing: "needs_support" (most answers missing several structural elements), "developing" (some structure present, inconsistent), "strong" (answers were consistently well-structured).

Dimensions to cover (skip any with nothing meaningful to say; 3-5 total):
- "Answer relevance" — did answers address what was asked?
- "Completeness" — did answers include situation, their own role, the action they took, and the outcome? Name which elements were present and which were missing.
- "Concrete examples" — did claims come with a specific example? Reference their actual words.
- "Listener context" — did they introduce people/projects before referring to them, or assume knowledge the interviewer didn't have?
- "Clarification" — did they ask when a question was ambiguous? (One question was deliberately ambiguous.) If they asked: praise it explicitly. If not: note gently that asking is allowed and effective.

Rules:
- Every observation is about the CANDIDATE (the "You" speaker in the transcript) — never about the interviewer or the questions themselves.
- Each observation: 1-2 sentences, descriptive and specific, citing what they actually said. Strengths count as observations too — name autistic strengths plainly when present (precision, detail, honesty, directness, subject depth).
- Each suggestion: optional, one concrete sentence about answer content/structure only. Prefer ASD-informed strategies that actually work for autistic candidates: use a template or script shape (that is allowed and effective), prepare a bank of 3-4 real stories in advance, ask for the question in writing, ask which meaning is intended, say "I need a moment to think". Never suggest "be more confident", "relax", "be natural", or anything about performing differently as a person.
- "focus": ONE sentence naming the single highest-leverage thing to practice next, phrased as a literal invitation ("Next time, try adding what happened at the end of each story."). No metaphors.
- "self_advocacy": 2-3 exact sentences the user could copy word-for-word in a REAL interview to request reasonable ASD accommodations (e.g. "Could you break that question into parts?", "I'd like a moment to think about that.", "Could I see the questions in writing?", "Do you mean X or Y?"). Pick ones that match what actually helped or was hard in THIS transcript.
- NEVER a score or grade in the text.
${TRACKING_SYSTEM_RULES}`;

// Teaching debrief (Feature 3): a per-question breakdown that TEACHES rather
// than just observes — a concrete rewritten answer plus the reasoning behind
// it, so the candidate can see exactly what a stronger version looks like and
// why. Content/structure coaching only, same as everything else in this file.
const TEACHING_PROMPT = `You write a per-question teaching breakdown for a private mock-interview debrief, for an autistic candidate (this tool is built specifically for ASD; literal, direct, concrete language only — no idioms, no metaphors).
Return ONLY valid JSON: {"question_breakdown":[{"what_worked":"...","stronger_version":"...","why_it_works":"...","practice_prompt":"..."}]}
Return EXACTLY one object per question given, in the same order.

Rules:
- "what_worked": one specific sentence naming something that worked in THIS answer, referencing what they actually said. If genuinely nothing worked, name their effort or an autistic strength (precision, honesty, directness) instead of inventing praise.
- "stronger_version": a concrete improved answer, written out in FULL, in first person, using the SAME facts/situation they already gave — never invent new personal facts. Reorganize, add missing structure (e.g. a missing outcome or their own specific role), lead with the direct answer, add specificity. Content and structure only.
- "why_it_works": 1-2 sentences explaining the reasoning (structure, specificity, relevance) — teach the pattern, don't just assert it's better.
- "practice_prompt": one short, self-contained question similar in shape to the original, for the candidate to answer again right now to practice the same skill.
${TRACKING_SYSTEM_RULES}`;

// Descriptive pacing note from turn timestamps. Relative comparisons only
// (absolute values include speech playback and transcription overhead), and
// framed so that taking time is normal — never "answer faster".
function describePacing(fullTranscript) {
  const gaps = [];
  for (let i = 1; i < fullTranscript.length; i++) {
    const prev = fullTranscript[i - 1];
    const cur = fullTranscript[i];
    const isUserTurn = cur.speaker === "You" || cur.speaker === "User";
    const prevIsAI = prev.speaker !== "You" && prev.speaker !== "User";
    if (isUserTurn && prevIsAI && Number.isFinite(cur.timestamp) && Number.isFinite(prev.timestamp)) {
      const gap = (cur.timestamp - prev.timestamp) / 1000;
      if (gap > 0 && gap < 600) gaps.push({ gap, questionText: prev.text || "" });
    }
  }
  if (gaps.length < 2) return null;

  const sorted = [...gaps].sort((a, b) => a.gap - b.gap);
  const median = sorted[Math.floor(sorted.length / 2)].gap;
  const longest = sorted[sorted.length - 1];

  let s = "You gave yourself a fairly even amount of thinking time across questions.";
  if (longest.gap > median * 2) {
    s = `You took noticeably more time on one question ("${longest.questionText.slice(0, 80)}${longest.questionText.length > 80 ? "…" : ""}") than on the others.`;
  }
  return `${s} Taking time to think is normal and works in real interviews too — saying "let me think about that for a moment" is always OK.`;
}

export default async function handler(req, res) {
  const {
    fullTranscript = [],
    situation = "",
    sessionData = null,
    signalData = null,               // [{ timestamp, signal_type, value }] derived client-side — never raw video
    userSelectedCategories = [],     // signal categories the user opted in to see
  } = req.body;

  const personas = sessionData?.personas || [];
  const mode = sessionData?.mode || "interview";
  const module = getModule(mode);
  const userTurns = fullTranscript.filter(t => t.speaker === "You" || t.speaker === "User");

  // Personalize the feedback to this user's self-set profile: name their
  // specific strengths, target their stated goal, coach with strategies that
  // match their traits. Empty string when they haven't set a profile.
  const asdHint = buildAsdProfileHint(req.user?.sub ? getAsdProfile(req.user.sub) : null, "debrief");
  const profileBlock = asdHint ? `\n\n${asdHint}` : "";

  const transcriptText = fullTranscript
    .map(t => `${t.speaker}: ${t.text}`)
    .join("\n");

  // ── Non-evaluative modules: lightweight optional recap, deliberately low-stakes ──
  if (!module.evaluative) {
    let recap = `You had a ${module.label.toLowerCase()} practice session. Your full transcript is below.`;
    if (userTurns.length > 0) {
      try {
        const raw = await callLLM({
          systemPrompt: `You write a short, warm recap of a casual practice session (${module.label}) for an autistic user (this tool is built specifically for ASD). Literal, direct, friendly language: no idioms, no metaphors. 2-3 sentences: what you talked about and one genuine, specific note about the conversation. Never a score, grade, or evaluation.
${TRACKING_SYSTEM_RULES}
Return ONLY: {"recap":"..."}`,
          userPrompt: `Transcript:\n${transcriptText.slice(0, 4000)}${profileBlock}`,
          maxTokens: 160,
        });
        const parsed = parseJSON(raw);
        if (parsed?.recap) recap = parsed.recap;
      } catch (e) {
        console.error("[debrief] recap failed:", e.message);
      }
    }
    return res.json({
      mode,
      transcript: transcriptText,
      persona_impressions: [{ persona: personas[0]?.name || `Your ${module.partnerTitle?.toLowerCase() || "conversation partner"}`, impression: recap }],
      signal_summary: signalData ? summarizeSignals(signalData, fullTranscript) : {},
      user_selected_categories: Array.isArray(userSelectedCategories) ? userSelectedCategories : [],
      session_facts: null,
    });
  }

  // ── Per-persona impressions (LLM, constructive, non-scored) ────────────────
  let impressions = [];
  if (userTurns.length > 0 && personas.length > 0) {
    try {
      const personaList = personas
        .map(p => `- ${p.name} (${p.role}) — style: ${p.style}`)
        .join("\n");
      const raw = await callLLM({
        systemPrompt: IMPRESSIONS_PROMPT,
        userPrompt: `Interview context: "${situation.slice(0, 200)}"
Panel (all fictional):
${personaList}

Transcript:
${transcriptText.slice(0, 6000)}

Write one impression per panel member. JSON now.${profileBlock}`,
        maxTokens: 900,
      });
      const parsed = parseJSON(raw);
      if (parsed?.impressions?.length) {
        impressions = parsed.impressions
          .filter(i => i?.persona && i?.impression)
          .slice(0, personas.length);
      }
    } catch (e) {
      console.error("[debrief] impressions failed:", e.message);
    }
  }
  if (!impressions.length && personas.length) {
    impressions = [{
      persona: personas[0].name,
      impression: "Thanks for practicing with us today. A written impression couldn't be generated for this session, but your full transcript is below — re-reading your own answers is one of the most useful ways to review.",
    }];
  }

  // ── Per-dimension communication observations + self-advocacy scripts ───────
  let communicationObservations = [];
  let focus = null;
  let selfAdvocacy = [];
  let answerStructureScore = null;
  if (userTurns.length > 0) {
    for (let attempt = 0; attempt < 2 && !communicationObservations.length; attempt++) {
      try {
        const raw = await callLLM({
          systemPrompt: OBSERVATIONS_PROMPT,
          userPrompt: `Interview context: "${situation.slice(0, 200)}"
Support level used: ${sessionData?.supportLevel || "standard"}
Planned questions (types noted): ${(sessionData?.sessionPlan?.questions || []).map(q => `[${q.type}] ${q.text}`).join(" | ").slice(0, 800)}

Transcript:
${transcriptText.slice(0, 5500)}

JSON now.${profileBlock}`,
          maxTokens: 1000,
        });
        const parsed = parseJSON(raw);
        if (Array.isArray(parsed?.observations)) {
          communicationObservations = parsed.observations
            .filter(o => o?.dimension && o?.observation)
            .slice(0, 5);
        }
        if (parsed?.focus) focus = String(parsed.focus);
        if (Array.isArray(parsed?.self_advocacy)) {
          selfAdvocacy = parsed.self_advocacy.filter(s => typeof s === "string").slice(0, 3);
        }
        if (["needs_support", "developing", "strong"].includes(parsed?.answer_structure_score)) {
          answerStructureScore = parsed.answer_structure_score;
        }
      } catch (e) {
        console.error(`[debrief] observations attempt ${attempt + 1} failed:`, e.message);
      }
    }
  }

  // ── Teaching debrief: per-question breakdown (Feature 3) ────────────────────
  let questionBreakdown = [];
  if (userTurns.length > 0) {
    const segments = segmentTranscriptByQuestion(fullTranscript, sessionData?.sessionPlan)
      .filter(s => s.user_answer_transcript.trim());
    if (segments.length) {
      try {
        const raw = await callLLM({
          systemPrompt: TEACHING_PROMPT,
          userPrompt: `Interview context: "${situation.slice(0, 200)}"
Questions and the candidate's full answer (initial answer plus any follow-ups):
${segments.map((s, i) => `${i + 1}. [${s.type || "question"}] "${s.question}"\nCandidate said: "${s.user_answer_transcript.slice(0, 600)}"`).join("\n\n")}

Return exactly ${segments.length} entries, in order. JSON now.${profileBlock}`,
          maxTokens: 1800,
        });
        const parsed = parseJSON(raw);
        if (Array.isArray(parsed?.question_breakdown)) {
          questionBreakdown = segments.map((s, i) => {
            const entry = parsed.question_breakdown[i] || {};
            return {
              question: s.question,
              user_answer_transcript: s.user_answer_transcript,
              what_worked: typeof entry.what_worked === "string" ? entry.what_worked : "",
              stronger_version: typeof entry.stronger_version === "string" ? entry.stronger_version : "",
              why_it_works: typeof entry.why_it_works === "string" ? entry.why_it_works : "",
              practice_prompt: typeof entry.practice_prompt === "string" ? entry.practice_prompt : "",
            };
          }).filter(e => e.what_worked || e.stronger_version);
        }
      } catch (e) {
        console.error("[debrief] question breakdown failed:", e.message);
      }
    }
  }

  // ── Neutral signal summaries (only if tracking data was shared) ─────────────
  const signalSummary = signalData ? summarizeSignals(signalData, fullTranscript) : {};

  // ── Pacing: descriptive thinking-time observation, opt-in and never graded ──
  const pacing = describePacing(fullTranscript);
  if (pacing) signalSummary.pacing = pacing;

  // ── Conversation facts (neutral, descriptive — not graded) ─────────────────
  const questionsAsked = fullTranscript.filter(t => t.speaker !== "You" && t.speaker !== "User").length;

  res.json({
    mode: "interview",
    transcript: transcriptText,
    persona_impressions: impressions,
    communication_observations: communicationObservations,
    focus,
    self_advocacy: selfAdvocacy,
    answer_structure_score: answerStructureScore,
    question_breakdown: questionBreakdown,
    signal_summary: signalSummary,
    user_selected_categories: Array.isArray(userSelectedCategories) ? userSelectedCategories : [],
    session_facts: {
      questions_asked: questionsAsked,
      answers_given: userTurns.length,
      personas: personas.map(p => ({ name: p.name, role: p.role, color: p.color })),
    },
  });
}
