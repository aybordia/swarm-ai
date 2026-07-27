// PROMPT VERSION: 2.0 — fully dynamic sessions: LLM-invented fictional personas
// (no hardcoded name/title/institution lists) + domain-tagged question bank.
import { generatePersonas } from "./personaGenerator.js";
import { composeSessionQuestions } from "../lib/questionBank.js";
import { parseIntent } from "./intentParser.js";
import { callLLM, parseJSON } from "../lib/llm.js";
import { getModule } from "../modules/index.js";

// Assign each question to the persona whose focus matches, balancing load
function assignQuestions(questions, personas) {
  const load = new Map(personas.map(p => [p.name, 0]));
  return questions.map(q => {
    const candidates = [...personas].sort((a, b) => {
      const aMatch = a.question_focus === q.type || a.question_focus === "mixed" ? 0 : 1;
      const bMatch = b.question_focus === q.type || b.question_focus === "mixed" ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return load.get(a.name) - load.get(b.name);
    });
    const chosen = candidates[0];
    load.set(chosen.name, load.get(chosen.name) + 1);
    return {
      text: q.text,
      type: q.type,
      domain: q.domain,
      note: q.note || null,
      assignedPersona: chosen.name,
      intent: q.type === "technical" ? "Domain question"
        : q.type === "motivational" ? "Motivation"
        : q.type === "clarification" ? "Clarification opportunity"
        : "Behavioral",
    };
  });
}

// Guided support: make the hidden expectations of each question explicit
// (Maras/Bath adapted-interview research: interviews measure the ability to
// infer what answer is wanted; stating it removes that hidden demand).
async function addExplicitParts(questions, intent) {
  try {
    const raw = await callLLMForParts(questions, intent);
    const parsed = parseJSON(raw);
    if (parsed?.parts?.length === questions.length) {
      return questions.map((q, i) => ({
        ...q,
        parts: Array.isArray(parsed.parts[i]) ? parsed.parts[i].slice(0, 4).map(String) : null,
      }));
    }
  } catch (e) {
    console.error("[architect] parts generation failed:", e.message);
  }
  return questions; // scaffold is an enhancement, never a blocker
}

function callLLMForParts(questions, intent) {
  return callLLM({
    systemPrompt: `For each interview question, list the 2-4 things an interviewer implicitly expects the answer to include, as short literal phrases the candidate can see on screen. Plain, concrete wording. For deliberately ambiguous questions, one part must be "It's OK to ask which meaning they intend". Return ONLY: {"parts":[["...","..."],["..."]]} with exactly one array per question, in order.`,
    userPrompt: `Context: ${intent?.program_type || "interview"} at ${intent?.institution || "an organization"}.\nQuestions:\n${questions.map((q, i) => `${i + 1}. ${q.text}${q.note ? ` (${q.note})` : ""}`).join("\n")}`,
    maxTokens: 500,
  });
}

export async function runArchitect({ situation, intent = null, mode = "interview", tone = "neutral", supportLevel = "guided", researcherOutput, styleHint, asdProfileHint = "", communicationProfileHint = null, researchContext }, writeChunk) {
  const module = getModule(mode);

  // Derive structured intent server-side if the client didn't send one
  if (!intent && module.usesQuestionBank) {
    writeChunk({ agent: "Architect", chunk: "Understanding your request…", thinking: true });
    try {
      intent = await parseIntent({ transcript: situation });
    } catch {
      intent = { institution: null, program_type: null, timeframe_days: null, num_interviewers: 3, domain: "general" };
    }
  }

  writeChunk({
    agent: "Architect",
    chunk: module.evaluative ? "Inventing your fictional interview panel…" : "Setting up your conversation partner…",
    thinking: true,
  });
  const personas = await generatePersonas({ intent, situation, mode, tone, module });

  // Non-question-bank modules: open-ended, no plan to march through
  let questions = [];
  if (module.usesQuestionBank) {
    writeChunk({ agent: "Architect", chunk: "Composing your question set…", thinking: true });
    const totalQuestions = Math.max(4, personas.length);
    const domain = module.questionBankTags?.domain || intent?.domain || "general";
    let bankQuestions;
    try {
      bankQuestions = await composeSessionQuestions({ domain, totalQuestions, intent });
    } catch (e) {
      console.error("[architect] question composition failed:", e.message);
      bankQuestions = (await composeSessionQuestions({ domain: "general", totalQuestions, intent: null, useLLM: false }));
    }
    questions = assignQuestions(bankQuestions, personas);

    // Guided support level (evaluative modules only): attach the explicit
    // expectations for each question
    if (module.evaluative && supportLevel === "guided") {
      writeChunk({ agent: "Architect", chunk: "Making the hidden expectations of each question explicit…", thinking: true });
      questions = await addExplicitParts(questions, intent);
    }
  }

  writeChunk({ agent: "Architect", chunk: "Session architected.", streamStart: true });

  const rc = researcherOutput || {};
  const sessionData = {
    agent: "Architect",
    situation,
    intent,
    mode,
    tone: module.evaluative ? tone : null,
    supportLevel: module.evaluative ? supportLevel : null,
    asdProfileHint,   // self-set profile directives, applied by the live interviewer / partner
    communicationProfileHint, // learned pacing/branching thresholds (Feature 4 branching interviewer)
    sessionSummary: !module.evaluative
      ? `${module.label} practice: ${situation}`
      : intent?.institution
      ? `Practice ${intent.program_type || ""} interview for ${intent.institution} with ${personas.length} simulated interviewer${personas.length > 1 ? "s" : ""}.`
      : `Practice session for: ${situation}`,
    personas,
    sessionPlan: {
      difficultyProgression: "gentle-start",
      totalEstimatedMinutes: module.sessionLengthMinutes || Math.max(5, questions.length + 1),
      questions,
    },
    openingLine: "",
    closingCondition: "After all planned questions are covered.",
    researchContext: {
      ...researchContext,
      psychologicalProfile: "",
      diagnosedWeakness: researchContext?.interviewerPatterns?.slice(0, 80) || "",
    },
  };

  writeChunk({ agent: "Architect", done: true, sessionData });
  return sessionData;
}
