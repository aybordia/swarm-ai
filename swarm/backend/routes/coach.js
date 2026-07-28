// The Coach — the persistent front door (Feature 1). Distinct from the
// per-session persona system: one stable voice/identity across every visit,
// proposing rather than auto-starting, and never coaching masking.
import { callLLM } from "../lib/llm.js";
import { TRACKING_SYSTEM_RULES } from "../lib/observationRules.js";
import { getCommunicationProfile, summarizeProfileForPrompt } from "../lib/communicationProfileStore.js";
import { getSessions } from "../lib/sessionStore.js";
import { COACH_VOICE_ID } from "../lib/elevenlabs.js";

const COACH_SYSTEM_PROMPT = `${TRACKING_SYSTEM_RULES}

You are the user's private, ongoing communication coach inside Swarm AI — not one of the practice personas they talk to during a drill. You are a stable presence they come back to, not a disposable character.

Voice: warm, direct, low-pressure. Say the thing plainly, in plain sentences. No filler enthusiasm, no exclamation points, no performative cheerfulness — many autistic users experience that as noise, not warmth.

You propose, the user disposes: never assume they want to continue a focus area, and never announce that a session is starting. Offer a concrete next step, then leave the actual choice to them, including the choice to do something else entirely or nothing at all.

Keep it short — 1 to 3 sentences.`;

export async function getCoachGreetingRoute(req, res) {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "auth required" });

  try {
    const profile = await getCommunicationProfile(userId);
    const sessions = await getSessions(userId);
    const recentSituations = sessions.slice(0, 3).map(s => s.situation).filter(Boolean);
    const summary = summarizeProfileForPrompt(profile, recentSituations);

    const userPrompt = profile.sessions_completed > 0
      ? `Write today's opening greeting for this returning user.\n\n${summary}\n\nIf there's a confirmed or possible focus area, or a recent session topic, reference it concretely and specifically — not a generic "welcome back". Close by inviting them to say what's actually on their mind today, separately from whatever you proposed.`
      : `This user has never completed a session. Write a plain, low-pressure welcome. Invite them to either say what they'd like to work on in their own words, or look through the practice library. Do not assume anything about why they're here.`;

    let greeting;
    try {
      greeting = (await callLLM({ systemPrompt: COACH_SYSTEM_PROMPT, userPrompt, maxTokens: 220 }))?.trim();
    } catch (e) {
      console.error("[coach] greeting LLM call failed:", e.message);
    }
    if (!greeting) {
      greeting = profile.sessions_completed > 0
        ? "Good to see you again. What would you like to work on today?"
        : "Hi — I'm glad you're here. Tell me what you'd like to work on, or take a look through the practice library.";
    }

    res.json({
      greeting,
      voiceId: COACH_VOICE_ID,
      activeFocusArea: profile.active_focus_area,
      proposedFocusArea: profile.active_focus_area ? null : profile.proposed_focus_area,
      sessionsCompleted: profile.sessions_completed,
    });
  } catch (err) {
    console.error("[coach] greeting route error:", err);
    res.status(500).json({ error: err.message });
  }
}
