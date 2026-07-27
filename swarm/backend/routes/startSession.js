import { runResearcher } from "../agents/researcher.js";
import { runArchitect } from "../agents/architect.js";
import { getPrefs, buildInterviewStyleHint, getAsdProfile, buildAsdProfileHint } from "../lib/prefsStore.js";
import { getCommunicationProfile } from "../lib/communicationProfileStore.js";
import { getModule } from "../modules/index.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const writeChunk = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === "function") res.flush();
  };

  // Send heartbeat immediately so the frontend knows the connection is open
  writeChunk({ heartbeat: true });

  const { situation, intent, mode = "interview", tone = "neutral", supportLevel = "guided" } = req.body;
  if (!situation) {
    writeChunk({ error: "situation is required" });
    return res.end();
  }

  // Load user preferences to personalise this session
  const userId = req.user?.sub;
  const userPrefs = userId ? getPrefs(userId) : null;
  const styleHint = buildInterviewStyleHint(userPrefs);
  if (styleHint) console.log(`[startSession] injecting style prefs for user=${userId} (${userPrefs.sessionCount} sessions)`);

  const module = getModule(mode);

  // The user's self-set ASD communication profile — the core personalization.
  // Baked into the session context so the live interviewer adapts to THIS person.
  const asdProfile = userId ? getAsdProfile(userId) : null;
  const asdProfileHint = buildAsdProfileHint(asdProfile, module.evaluative ? "interview" : "conversation");
  if (asdProfileHint) console.log(`[startSession] injecting ASD profile for user=${userId}`);

  // The learned communication profile — a small plain object (not prose, the
  // judge needs strugglesAfterNFollowups programmatically), threaded the same
  // way asdProfileHint is baked in, so the branching interviewer (Feature 4)
  // can respect the user's own learned pacing rather than a generic default.
  let communicationProfileHint = null;
  if (userId) {
    try {
      const profile = await getCommunicationProfile(userId);
      communicationProfileHint = {
        strugglesAfterNFollowups: profile.user_preferences_learned?.struggles_after_n_followups ?? null,
        prefersLongerThinkingTime: !!profile.user_preferences_learned?.prefers_longer_thinking_time,
      };
    } catch (e) {
      console.error("[startSession] communication profile load failed:", e.message);
    }
  }

  // Keepalive: send a heartbeat every 8s so Render's proxy never kills
  // the SSE connection during rate-limit waits between agent LLM calls
  const keepalive = setInterval(() => writeChunk({ heartbeat: true }), 8000);

  try {
    // Modules that skip research: no research, no agent theater — one calm setup step
    if (module.skipResearch) {
      await runArchitect({ situation, intent, mode, tone, supportLevel, researcherOutput: null, styleHint: null, asdProfileHint, communicationProfileHint, researchContext: {} }, writeChunk);
      return;
    }

    // Only 2 LLM calls: Researcher (Tavily + synthesis) → Architect (designs everything)
    const researcherOutput = await runResearcher({ situation }, writeChunk);

    const researchContext = {
      interviewerPatterns: researcherOutput.interviewerPatterns || "",
      successPatterns:     researcherOutput.successPatterns     || "",
      redFlags:            researcherOutput.redFlags            || [],
      keyFindings:         (researcherOutput.keyFindings || []).slice(0, 4).map(f => f.insight || f),
      rawSummary:          researcherOutput.rawSummary          || "",
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Run UI agents one-by-one with brief thinking windows
    // (their work is handled inside Architect — these keep MissionControl in sync)
    writeChunk({ agent: "Profiler", chunk: `Profiling panel psychology for: ${situation.slice(0, 60)}…`, thinking: true });
    await sleep(1400);
    writeChunk({ agent: "Profiler", done: true });

    await sleep(300);
    writeChunk({ agent: "WeakSpotFinder", chunk: researcherOutput.diagnosedWeakness || "Targeting high-leverage weak spots…", thinking: true });
    await sleep(1200);
    writeChunk({ agent: "WeakSpotFinder", done: true });

    await sleep(300);
    writeChunk({ agent: "VoiceDesigner", chunk: "Matching voice profiles to personas…", thinking: true });
    await sleep(1000);
    writeChunk({ agent: "VoiceDesigner", done: true });

    await sleep(300);
    await runArchitect({ situation, intent, mode, tone, supportLevel, researcherOutput, styleHint, asdProfileHint, communicationProfileHint, researchContext }, writeChunk);

  } catch (err) {
    console.error("startSession error:", err);
    writeChunk({ error: err.message });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}
