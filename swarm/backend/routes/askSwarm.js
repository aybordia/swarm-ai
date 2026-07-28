import { callLLM, callLLMStream } from "../lib/llm.js";
import { TRACKING_SYSTEM_RULES } from "../lib/observationRules.js";

const SYSTEM_PROMPT = `You are Swarm AI, an honest, supportive interview coach who just watched the user's full practice session. You have:
- The full verbatim transcript of every question asked and every answer the user gave
- The debrief (per-interviewer impressions and optional neutral tracking observations)
- The session context (what they were preparing for, the fictional personas who interviewed them)

Your job: answer the user's questions about their interview with specific, direct, evidence-based responses. Always cite what they actually said when relevant — quote their exact words from the transcript. Never be vague. If they ask "how did I do on X", pull the specific moment from the transcript and describe concretely what worked and what could be stronger in the CONTENT of the answer.

Boundaries on any tracked signal or observation you reference:
${TRACKING_SYSTEM_RULES}

Tone: direct, warm, coach-like, literal wording. No fluff. No "great question!" openers. Just the answer.`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const writeChunk = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const { question, interviewTranscript, situation, debrief, sessionData, chatHistory = [] } = req.body;

  if (!question?.trim()) {
    writeChunk({ error: "question is required" });
    return res.end();
  }

  try {
    const contextBlock = `
SITUATION THE USER WAS PREPARING FOR:
"${situation}"

FULL INTERVIEW TRANSCRIPT:
${(interviewTranscript || []).map(t => `${t.speaker}: ${t.text}`).join("\n")}

DEBRIEF:
${(debrief?.persona_impressions || []).map(i => `- ${i.persona}: ${i.impression}`).join("\n") || "- no impressions recorded"}
${Object.entries(debrief?.signal_summary || {}).map(([k, v]) => `- Observation (${k}): ${v}`).join("\n")}

SESSION PLAN:
${sessionData?.sessionPlan ? JSON.stringify(sessionData.sessionPlan, null, 2) : "not available"}
`.trim();

    const priorChat = chatHistory.map(m =>
      `${m.role === "user" ? "User" : "Swarm AI"}: ${m.content}`
    ).join("\n");

    const userPrompt = `${contextBlock}

${priorChat ? `PRIOR CONVERSATION:\n${priorChat}\n` : ""}
USER'S QUESTION:
${question}`;

    await callLLMStream({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 600,
      onChunk: (tok) => writeChunk({ chunk: tok, done: false }),
    });
    writeChunk({ chunk: "", done: true });

  } catch (err) {
    console.error("askSwarm error:", err);
    writeChunk({ error: err.message });
  } finally {
    res.end();
  }
}
