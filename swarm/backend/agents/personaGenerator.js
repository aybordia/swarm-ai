// PROMPT VERSION: 1.0 — fully dynamic fictional persona generation.
// Zero hardcoded name/title/institution lists: every persona is invented
// fresh per session by the LLM. All personas are fictional and labeled so.
import { callLLM, parseJSON } from "../lib/llm.js";
import { VOICE_IDS } from "../lib/elevenlabs.js";
import { getModule } from "../modules/index.js";

// Matches the frontend token system: honey, sage, sky, rose, lilac (all muted)
const PALETTE = ["#E4A339", "#74B9A0", "#8FB6E8", "#D98B8B", "#B39BD8"];
const FOCUS_CYCLE = ["behavioral", "technical", "motivational", "mixed"];

// Distinct voice deliveries so personas sound different even on the same voice model
const VOICE_DELIVERIES = [
  { stability: 0.30, similarityBoost: 0.85 }, // expressive, animated
  { stability: 0.55, similarityBoost: 0.80 }, // measured, even
  { stability: 0.42, similarityBoost: 0.90 }, // warm, natural
  { stability: 0.65, similarityBoost: 0.75 }, // flat, deliberate
  { stability: 0.38, similarityBoost: 0.82 }, // brisk, energetic
];

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// JS-side randomness for names: the LLM must invent a name matching randomly
// drawn initial letters, so names can't collapse into the model's favorites.
// Letters only — never a name list.
const NAME_LETTERS = "ABCDEFGHIJKLMNOPRSTVWZ".split("");

function randomNameConstraints(n) {
  const firsts = shuffled(NAME_LETTERS);
  const lasts = shuffled(NAME_LETTERS);
  return Array.from({ length: n }, (_, i) =>
    `Persona ${i + 1}: first name starts with "${firsts[i]}", family name starts with "${lasts[i]}"`
  );
}

const SYSTEM_PROMPT = `You invent completely original FICTIONAL interviewer personas for a mock-interview simulator.
Return ONLY valid JSON, no markdown: {"personas":[{"name":"...","title":"...","personality_style":"...","question_focus":"technical|behavioral|motivational|mixed"}]}

Hard rules:
- Every persona is invented and fictional. NEVER model, name, or imply any real identifiable person, even though the institution named may be real.
- Invent names fresh each time: vary cultural origins, genders, formality, and sound. Do not reuse stock mock-interview names or settle into repeating patterns.
- Titles must be plausible for the TYPE of organization, inferred generically (a company → role-style titles like "Senior Engineering Manager"; a university → academic titles like "Associate Professor of Chemistry"; a hospital → clinical titles). Do NOT claim a specific real department, lab, or person exists.
- personality_style: one vivid sentence describing how they interview (tone, pace, what they probe). Every persona in the set must differ meaningfully in style — never all warm, never all aggressive.
- question_focus values must be varied across the set (mix of technical/behavioral/motivational/mixed as appropriate to the interview type).
- Ground the question STYLE (not identity) in generically known patterns for this interview type: e.g., behavioral-heavy for university admissions, one light technical thread for engineering roles.`;

function fallbackPersonas(n, module) {
  if (!module.evaluative && module.partnerTitle) {
    return [{
      name: `Your ${module.partnerTitle.toLowerCase()}`,
      title: module.partnerTitle,
      personality_style: "Relaxed and friendly; follows your lead and keeps things easygoing.",
      question_focus: "mixed",
    }];
  }
  // Last-resort generic panel — intentionally institution-agnostic, no invented-name lists
  const styles = [
    "Calm and structured; asks one clear question at a time and waits patiently.",
    "Curious and detail-oriented; follows up on specifics you mention.",
    "Warm and encouraging; focuses on motivation and what drives you.",
    "Direct and concise; asks practical questions about how you work.",
    "Reflective and open-ended; invites you to think out loud.",
  ];
  return Array.from({ length: n }, (_, i) => ({
    name: `Panelist ${i + 1}`,
    title: "Panel Interviewer",
    personality_style: styles[i % styles.length],
    question_focus: FOCUS_CYCLE[i % FOCUS_CYCLE.length],
  }));
}

// Interview tone presets — set by the user at session setup, default neutral.
// Even "challenging" keeps the hard conduct rules (never mocks, never comments
// on pauses or delivery); it changes pressure and warmth, not respect.
const TONES = {
  supportive: "All personas are warm, patient, and encouraging. They acknowledge effort, give the candidate room, and phrase questions gently.",
  neutral: "All personas are professional and even-keeled. Courteous but not effusive; focused on substance.",
  challenging: "All personas are direct and high-pressure: terse follow-ups, brisk pacing, little small talk, they press hard for specifics and push back on vague answers. Firm but never mocking or hostile.",
};

export async function generatePersonas({ intent, situation = "", mode = "interview", tone = "neutral", module }) {
  // Destructuring defaults only fire on `undefined` — non-evaluative launches
  // (conversation, networking, and every new non-evaluative drill) explicitly
  // pass `intent: null`, which skips the default and crashes on intent.* below.
  intent = intent || {};
  const mod = module || getModule(mode);
  const { min = 1, max = 5 } = mod.personaCount || {};
  const fallbackN = mod.evaluative ? 3 : min;
  const n = Math.min(Math.max(Number(intent.num_interviewers) || fallbackN, min), max);
  const toneRule = TONES[tone] || TONES.neutral;
  const context = [
    !mod.evaluative
      ? mod.systemPromptFragment
      : `Interview tone selected by the candidate: ${tone}. ${toneRule}`,
    intent?.institution && `Institution/company: ${intent.institution}`,
    intent?.program_type && `Program type: ${intent.program_type}`,
    intent?.domain && `Subject domain: ${intent.domain}`,
    situation && `Candidate's own words: "${situation.slice(0, 200)}"`,
  ].filter(Boolean).join("\n");

  let personas = null;
  for (let attempt = 0; attempt < 2 && !personas; attempt++) {
    // Fresh random constraints per attempt: names differ on every single prompt
    const nameRules = randomNameConstraints(n).join("\n");
    try {
      const raw = await callLLM({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `${context}
Number of personas: EXACTLY ${n}.
Name constraints (mandatory — invent names that fit these random initials, vary cultural origins across the set):
${nameRules}
Output JSON now.`,
        maxTokens: 600,
      });
      const parsed = parseJSON(raw);
      if (parsed?.personas?.length) {
        personas = parsed.personas
          .slice(0, n)
          .filter(p => p?.name && p?.title)
          .map(p => ({ ...p, name: String(p.name).replace(/[,;:.\s]+$/g, "").trim() }));
        if (personas.length < n) personas = [...personas, ...fallbackPersonas(n - personas.length, mod)];
      }
    } catch (e) {
      console.error(`[personaGenerator] attempt ${attempt + 1} failed:`, e.message);
    }
  }
  if (!personas) personas = fallbackPersonas(n, mod);

  // Map each persona to a distinct ElevenLabs voice + a distinct delivery profile
  const voices = shuffled(Object.values(VOICE_IDS));
  const deliveries = shuffled(VOICE_DELIVERIES);

  return personas.map((p, i) => ({
    // Canonical fields used across the app
    name: p.name,
    role: p.title,
    style: p.personality_style || "Asks clear, direct questions.",
    voiceId: voices[i % voices.length],
    voiceSettings: deliveries[i % deliveries.length],
    color: PALETTE[i % PALETTE.length],
    orbIndex: i,
    // Spec-shaped aliases + fiction labeling
    title: p.title,
    personality_style: p.personality_style || "Asks clear, direct questions.",
    question_focus: FOCUS_CYCLE.includes(p.question_focus) ? p.question_focus : FOCUS_CYCLE[i % FOCUS_CYCLE.length],
    voice_profile_id: voices[i % voices.length],
    fictional: true,
    fiction_label: "Simulated interviewer — fictional, not a real person.",
  }));
}
