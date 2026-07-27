// PROMPT VERSION: 5.0 — walks the composed question plan with assigned personas.
// Accessibility constraints: one clear literal question at a time; never comments
// on the candidate's pauses, pacing, speech patterns, or body language.
import { callLLM, parseJSON } from "../lib/llm.js";
import { TRACKING_SYSTEM_RULES } from "../lib/observationRules.js";
import { getModule } from "../modules/index.js";

const clip = (s, n = 80) => s && s.length > n ? s.slice(0, n) + "…" : (s || "");

const CONDUCT_RULES = `Conduct rules (always apply):
- Ask ONE question at a time. Clear, literal, direct wording — no idioms, no trick phrasing, no multi-part questions.
${TRACKING_SYSTEM_RULES}
- If the candidate asks a clarifying question, that is a GOOD interview skill: answer their clarification helpfully and specifically, then restate your question more precisely. Never treat it as evasion.
- React genuinely to the CONTENT of what they said. Brief acknowledgment, then your question.
- 1-2 sentences max. No filler.`;

const SUPPORT_RULES = {
  guided: `Support level: GUIDED (accommodation mode, research-based).
- If the planned question has multiple expected components, ask about ONE component at a time rather than all at once.
- If their answer covered the topic but skipped an expected component, your follow-up asks plainly for that specific component (e.g. "What did you do next?" or "Can you give one specific example?").
- Be explicit about what kind of answer you're looking for — no hidden expectations.`,
  standard: `Support level: STANDARD. Ask questions plainly; follow-ups may ask for a concrete example when one is missing.`,
  realistic: `Support level: REALISTIC (transfer practice). Ask questions the way a real interviewer would, with natural unscaffolded follow-ups. All conduct rules above still apply.`,
};

function safeReturn(p, line, intent, extras = {}) {
  return {
    nextPersona: p?.name || "Interviewer",
    voiceId: p?.voiceId || null,
    voiceSettings: p?.voiceSettings || null,
    line,
    intent,
    sessionAdvancing: false,
    sessionComplete: false,
    userPerformanceNote: "",
    ...extras,
  };
}

// Replays AI turns (each tagged with questionIndex/isAdvancing by the client
// — see VoiceSession.jsx) to derive "which planned question are we on, and
// how many follow-ups has it already had" statelessly from history alone,
// same statelessness class as the old fixed-division approach but able to
// support variable follow-up depth (branching) instead of a hardcoded
// turns-per-question constant.
function deriveQuestionState(history) {
  let qIndex = 0, followupDepth = 0, started = false;
  for (const turn of history) {
    const isAI = turn.speaker !== "You" && turn.speaker !== "User";
    if (!isAI || !Number.isFinite(turn.questionIndex)) continue;
    if (!started || turn.isAdvancing || turn.questionIndex !== qIndex) {
      qIndex = turn.questionIndex;
      followupDepth = 0;
      started = true;
    } else {
      followupDepth += 1;
    }
  }
  return { qIndex, followupDepth };
}

// ── Branching follow-ups ────────────────────────────────────────────────────
// After each answer the judge picks ONE follow-up branch rather than a fixed
// "always ask exactly one generic follow-up" — the question bank still
// supplies the topic, the LLM only generates the wording from the user's
// actual words. "missing_part" reuses the existing guided-support-level
// behavior (ask for a specific expected component that was skipped);
// the other three are the spec's general-purpose branches.
const BRANCH_CYCLE = ["concrete_example", "probe_assumption", "add_constraint"];

function pickBranchType(question, followupDepth) {
  if (question?.parts?.length && followupDepth === 0) return "missing_part";
  return BRANCH_CYCLE[followupDepth % BRANCH_CYCLE.length];
}

const BRANCH_TASKS = {
  missing_part: (question, partsHint) =>
    `Ask ONE brief follow-up about something specific they just said. Stay on the current topic: "${clip(question?.text, 100)}"${partsHint}`,
  concrete_example: (question) =>
    `Ask ONE brief follow-up requesting a specific, concrete example, number, or detail tied to what they just said — not a restatement of the question. Stay on: "${clip(question?.text, 100)}"`,
  probe_assumption: (question) =>
    `They stated something as a given in their answer. Ask ONE brief follow-up gently probing that assumption — ask why they chose that approach or what led them to it. Stay on: "${clip(question?.text, 100)}"`,
  add_constraint: (question) =>
    `Ask ONE brief follow-up that adds a new constraint to their scenario (e.g. "suppose you only had half the time" or "suppose that resource were unavailable") and ask how their approach would change. Stay on: "${clip(question?.text, 100)}"`,
};

export async function runJudgeOrchestrator({ transcript, sessionContext, history, currentQuestionIndex = 0 }) {
  let parsed;
  try {
    parsed = typeof sessionContext === "string" ? JSON.parse(sessionContext) : sessionContext;
  } catch (e) {
    console.error("[judge] bad sessionContext:", e.message);
    return safeReturn(null, "Let's continue. Tell me more about your situation.", "Recovery");
  }

  const { personas = [], sessionPlan, situation = "", mode = "interview", tone = "neutral", supportLevel = "guided", asdProfileHint = "", communicationProfileHint = null } = parsed;
  if (!personas.length) {
    return safeReturn(null, "Walk me through your situation in your own words.", "Recovery");
  }

  const module = getModule(mode);

  // Self-set profile directives, appended to every prompt so the interviewer
  // adapts to THIS person (not a generic ASD template).
  const profileBlock = asdProfileHint ? `\n${asdProfileHint}` : "";

  // ── Non-evaluative modules (conversation, networking, …): casual,
  // follow-the-user's-lead, no plan to march through ─────────────────────────
  if (!module.evaluative) {
    const topics = (sessionPlan?.questions || []).map(q => q.text);
    return runConversationTurn({ transcript, personas, situation, history, profileBlock, module, topics });
  }

  const TONE_LINES = {
    supportive: "Your tone: warm and encouraging. Acknowledge what they said kindly before your question.",
    neutral: "Your tone: professional and even.",
    challenging: "Your tone: direct and brisk. Terse follow-ups, no small talk, push for specifics, politely push back on vague answers. Firm but never mocking.",
  };
  const toneLine = TONE_LINES[tone] || TONE_LINES.neutral;
  const supportRule = SUPPORT_RULES[supportLevel] || SUPPORT_RULES.guided;

  const questions = sessionPlan?.questions || [];
  const userTurns = history.filter(t => t.speaker === "You" || t.speaker === "User").length;

  // ── Opening turn — its own persona lookup (question 0), returns early ──────
  if (!transcript && history.length === 0) {
    const firstQ = questions[0];
    const openP = personas.find(x => x.name === firstQ?.assignedPersona) || personas[0];
    try {
      const raw = await callLLM({
        systemPrompt: `You are ${openP.name}, ${openP.role} (a fictional simulated interviewer). Style: ${openP.style}
${toneLine}
${supportRule}
Situation: "${clip(situation, 120)}"
${CONDUCT_RULES}${profileBlock}
Introduce yourself briefly (name + role)${supportLevel === "guided" ? ", tell them they can ask you to clarify or repeat any question at any time," : ""} then ask this planned opening question in your own natural words: "${firstQ?.text || "What brought you here today?"}"
Return ONLY: {"line":"..."}`,
        userPrompt: situation,
        maxTokens: 140,
      });
      const result = parseJSON(raw);
      if (result?.line) return safeReturn(openP, result.line, "Opening", { userPerformanceNote: "Session started", question: { text: firstQ?.text, parts: firstQ?.parts || null, type: firstQ?.type, index: 0 } });
    } catch (err) {
      console.error("[judge] opening error:", err.message);
    }
    return safeReturn(openP, `Hi, I'm ${openP.name} — ${openP.role}. ${supportLevel === "guided" ? "You can ask me to clarify or repeat any question at any time. " : ""}${firstQ?.text || "To start: what are you preparing for?"}`, "Opening fallback", { userPerformanceNote: "Session started", question: { text: firstQ?.text, parts: firstQ?.parts || null, type: firstQ?.type, index: 0 } });
  }

  // How many follow-ups this question gets before the judge moves on.
  // Default caps (no learned profile yet) reproduce the original fixed
  // "always exactly one follow-up" behavior for supportive/neutral tone;
  // challenging allows a bit more probing, matching its existing description
  // ("push for specifics"). Once the user's communication profile has
  // learned struggles_after_n_followups, it can raise the cap — but the tone
  // setting always remains a hard ceiling, per product requirement.
  const TONE_FOLLOWUP_CAP = { supportive: 1, neutral: 1, challenging: 2 };
  const toneCap = TONE_FOLLOWUP_CAP[tone] ?? 1;
  const learnedCap = communicationProfileHint?.strugglesAfterNFollowups;
  const struggleCap = Number.isFinite(learnedCap) ? Math.max(1, learnedCap) : toneCap;
  const maxFollowups = module.branchingEnabled ? Math.min(struggleCap, toneCap) : 1;

  // Replay history (populated from question 0 onward, since the opening turn
  // above always runs first) to find the current question and follow-up depth.
  const { qIndex: currentQIndex, followupDepth } = deriveQuestionState(history);
  const currentQuestion = questions[Math.min(currentQIndex, Math.max(questions.length - 1, 0))] || null;
  const isFollowUp = !!currentQuestion && followupDepth < maxFollowups;

  let qIndex, question, advancing;
  if (isFollowUp) {
    qIndex = currentQIndex;
    question = currentQuestion;
    advancing = false;
  } else {
    qIndex = currentQIndex + 1;
    question = questions[qIndex] || null;
    advancing = true;
  }

  // ── Session end: no more planned questions to move to ──────────────────────
  if (advancing && qIndex >= questions.length) {
    return safeReturn(personas.find(x => x.name === currentQuestion?.assignedPersona) || personas[0],
      "That covers everything we planned to explore. Thank you — you'll get your full debrief now.", "End",
      { sessionComplete: true, userPerformanceNote: "Session completed" });
  }

  // Persona: whoever the current question is assigned to
  const p = personas.find(x => x.name === question?.assignedPersona)
    || personas[qIndex % personas.length];

  // Sent to the UI so the current question (and, in guided mode, its explicit
  // expectations) stays visible on screen while the candidate answers
  const questionMeta = question ? {
    text: question.text,
    parts: question.parts || null,
    type: question.type,
    index: qIndex,
  } : null;

  const trimmed = (transcript || "").trim();
  const recentHistory = history.slice(-4).map(t => `${t.speaker}: ${t.text}`).join("\n");

  const partsHint = question?.parts?.length
    ? `\nThe expected components of a full answer to this question are: ${question.parts.join("; ")}.`
    : "";
  const clarificationHint = question?.type === "clarification" && question?.note
    ? `\nNote about this question: ${question.note}`
    : "";

  const branchType = isFollowUp ? pickBranchType(question, followupDepth) : null;
  const task = isFollowUp
    ? BRANCH_TASKS[branchType](question, partsHint)
    : `Transition naturally, then ask this planned question in your own words${question?.type === "clarification" ? " (keep its ambiguity intact — do not clarify unless asked)" : ""}: "${question?.text}"${question?.type === "technical" ? " (domain question — keep it concrete and approachable)" : ""}${clarificationHint}`;

  const systemPrompt = `You are ${p.name}, ${p.role} (a fictional simulated interviewer). Style: ${p.style}
${toneLine}
${supportRule}
Situation: "${clip(situation, 120)}"
${CONDUCT_RULES}${profileBlock}
Task: ${task}
Return ONLY: {"line":"...","intent":"..."}`;

  try {
    const raw = await callLLM({ systemPrompt, userPrompt: `${recentHistory}\nUser: "${transcript}"`, maxTokens: 120 });
    const result = parseJSON(raw);
    if (result?.line) {
      const sentences = result.line.match(/[^.!?]+[.!?]+/g) || [result.line];
      const line = sentences.slice(0, 3).join(" ").trim();
      return safeReturn(p, line, result.intent || (isFollowUp ? "Follow-up" : "Planned question"), { sessionAdvancing: advancing, question: questionMeta });
    }
  } catch (err) {
    console.error("[judge] LLM error:", err.message);
  }

  // Fallback: ask the planned question verbatim — always coherent
  if (!isFollowUp && question?.text) {
    return safeReturn(p, question.text, "Planned question (fallback)", { sessionAdvancing: advancing, question: questionMeta });
  }
  // Last-resort follow-up: a natural, neutral prompt. NEVER echo the candidate's
  // raw words back — that parrots filler ("Uh, uh…") and reads like a broken bot.
  const FALLBACK_FOLLOWUPS = [
    "Thank you. Could you tell me a bit more about that?",
    "Got it. Can you walk me through that in a little more detail?",
    "Thanks. Could you give me a specific example of what you mean?",
    "That's helpful. What happened next?",
  ];
  return safeReturn(p, FALLBACK_FOLLOWUPS[userTurns % FALLBACK_FOLLOWUPS.length], "Follow-up (fallback)");
}

// ── Non-evaluative modules (conversation, networking, …) ───────────────────
// Casual practice: one friendly fictional persona, follows the user's lead,
// never evaluates. Same conduct rules — literal language, no comments on
// pauses or delivery. No fixed plan to march through; `topics` (when the
// module composes a question bank, e.g. networking) are offered as loose
// conversation starters, never a required order.
async function runConversationTurn({ transcript, personas, situation, history, profileBlock = "", module, topics = [] }) {
  const p = personas[0];
  const partnerNoun = module?.partnerTitle?.toLowerCase() || "conversation partner";

  const topicsHint = topics.length
    ? `\nYou have a few natural topics in your back pocket if things stall (not required, don't force them, never read them out as a list): ${topics.slice(0, 4).join("; ")}.`
    : "";

  const CONVO_RULES = `Conversation rules (always apply):
- This is relaxed, casual practice. You are NOT an interviewer and you NEVER evaluate, grade, or coach.
- Follow the user's lead: respond genuinely to what they said, share a brief thought or reaction of your own, and keep the conversation going naturally.
- Ask at most ONE gentle, open question per turn, and it's fine to sometimes just respond without a question.
- Clear, literal, friendly language. No idioms that could confuse, no sarcasm.
${TRACKING_SYSTEM_RULES}
- 1-3 short sentences.`;

  // Opening
  if (!transcript && history.length === 0) {
    try {
      const raw = await callLLM({
        systemPrompt: `You are ${p.name} (a fictional ${partnerNoun}). Style: ${p.style}
${module?.systemPromptFragment || ""}
The user's words: "${clip(situation, 120)}"
${CONVO_RULES}${profileBlock}${topicsHint}
Say a friendly hello, mention your first name, and open gently around what they said they'd like to talk about.
Return ONLY: {"line":"..."}`,
        userPrompt: situation,
        maxTokens: 100,
      });
      const result = parseJSON(raw);
      if (result?.line) return safeReturn(p, result.line, "Conversation opening", { userPerformanceNote: "Conversation started" });
    } catch (err) {
      console.error("[judge] conversation opening error:", err.message);
    }
    return safeReturn(p, `Hi, I'm ${p.name.split(/\s+/)[0]}. Nice to meet you. What would you like to chat about today?`, "Conversation opening fallback", { userPerformanceNote: "Conversation started" });
  }

  const recentHistory = history.slice(-6).map(t => `${t.speaker}: ${t.text}`).join("\n");
  try {
    const raw = await callLLM({
      systemPrompt: `You are ${p.name} (a fictional ${partnerNoun}). Style: ${p.style}
${module?.systemPromptFragment || ""}
${CONVO_RULES}${profileBlock}${topicsHint}
Return ONLY: {"line":"..."}`,
      userPrompt: `${recentHistory}\nUser: "${transcript}"`,
      maxTokens: 110,
    });
    const result = parseJSON(raw);
    if (result?.line) return safeReturn(p, result.line, "Conversation");
  } catch (err) {
    console.error("[judge] conversation error:", err.message);
  }
  return safeReturn(p, "That sounds interesting. Tell me more about it?", "Conversation fallback");
}
