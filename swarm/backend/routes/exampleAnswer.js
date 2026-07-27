// Generates a concrete example answer + structure for ONE specific question,
// on demand, for the answer-template popup. ASD-informed: literal language, a
// worked example the user can adapt, and a clear step structure. The example
// uses obviously-placeholder specifics so it's a shape to copy, not a script
// to memorize or repeat verbatim.
import { callLLM, parseJSON } from "../lib/llm.js";
import { TRACKING_SYSTEM_RULES } from "../lib/observationRules.js";

const SYSTEM_PROMPT = `You help an autistic (ASD) interview candidate answer ONE specific interview question. Return ONLY valid JSON:
{"steps":[{"label":"...","hint":"..."}],"example":"..."}

Rules:
- Everything must be about the EXACT question given. Never drift to an unrelated topic.
- "steps": 3-5 short parts a strong answer to THIS question includes. Each label is 1-4 words; each hint is one literal sentence, plain wording, no idioms or metaphors.
- "example": one worked example answer to THIS question, 2-4 sentences, in the first person. Use clearly generic placeholders in [square brackets] for anything personal (e.g. "[the project]", "[my teammate]") so the candidate adapts it rather than copies it. It must directly answer the question asked.
- If the question is deliberately vague/ambiguous, the first step is to ask which meaning is intended, and the example starts by asking for clarification.
${TRACKING_SYSTEM_RULES}`;

export default async function handler(req, res) {
  const { question, situation = "" } = req.body || {};
  const qText = typeof question === "string" ? question : question?.text;
  if (!qText?.trim()) return res.status(400).json({ error: "question is required" });

  const qType = question?.type || "behavioral";
  try {
    const raw = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Interview context: "${String(situation).slice(0, 200)}"
Question type: ${qType}
The exact question is: "${qText}"

Write steps and one worked example for THIS question. JSON now.`,
      maxTokens: 500,
    });
    const parsed = parseJSON(raw);
    const steps = Array.isArray(parsed?.steps)
      ? parsed.steps
          .filter(s => s?.label && s?.hint)
          .slice(0, 5)
          .map(s => ({ label: String(s.label), hint: String(s.hint) }))
      : [];
    const example = typeof parsed?.example === "string" ? parsed.example : "";
    if (!steps.length && !example) throw new Error("empty generation");
    res.json({ steps, example, questionText: qText });
  } catch (e) {
    console.error("[exampleAnswer] failed:", e.message);
    // The frontend keeps its static per-type template as a fallback
    res.status(200).json({ steps: [], example: "", questionText: qText, fallback: true });
  }
}
