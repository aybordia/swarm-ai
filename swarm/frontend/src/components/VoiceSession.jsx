import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { streamFetch, postJSON } from "../lib/api";
import { speakText, stopAllAudio } from "../hooks/useVoiceOutput";
import { useElevenLabsSTT } from "../hooks/useElevenLabsSTT";
import { useMultimodalTracking } from "../tracking/useMultimodalTracking";
import { countFillerWords } from "../lib/fillerWords";
import PanelRail, { QuestionRail } from "./PanelRail";

const sv = {
  initial: { opacity: 0, filter: "blur(10px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, filter: "blur(8px)", transition: { duration: 0.35 } },
};

const WAVEFORM_BARS = 28;

/* Mic waveform — real frequency data while the user speaks */
function MicWaveform({ active, analyserRef }) {
  const barsRef = useRef(Array(WAVEFORM_BARS).fill(4));
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const barW = Math.floor(W / WAVEFORM_BARS) - 1;
    const dataArray = analyserRef?.current
      ? new Uint8Array(analyserRef.current.frequencyBinCount)
      : null;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      if (active && analyserRef?.current && dataArray) {
        analyserRef.current.getByteFrequencyData(dataArray);
        const step = Math.floor(dataArray.length / WAVEFORM_BARS);
        for (let i = 0; i < WAVEFORM_BARS; i++) {
          const raw = dataArray[i * step] / 255;
          barsRef.current[i] = barsRef.current[i] * 0.75 + raw * 0.25;
        }
      } else {
        for (let i = 0; i < WAVEFORM_BARS; i++) barsRef.current[i] *= 0.85;
      }
      barsRef.current.forEach((val, i) => {
        const barH = Math.max(2, val * (H - 4));
        ctx.fillStyle = "rgba(116,185,160,0.85)";
        ctx.beginPath();
        ctx.roundRect(i * (barW + 1), (H - barH) / 2, barW, barH, 2);
        ctx.fill();
      });
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [active, analyserRef]);

  return (
    <canvas ref={canvasRef} width={WAVEFORM_BARS * 7} height={30}
      style={{ display: "block", opacity: active ? 1 : 0.15, transition: "opacity 0.4s" }} />
  );
}

/* Self-view mirror — the user's own camera, visible only to them, never recorded */
function SelfView({ stream }) {
  const videoRef = useRef(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, hidden]);

  if (!stream) return null;

  if (hidden) {
    return (
      <button className="btn btn-ghost" onClick={() => setHidden(false)}
        style={{ position: "fixed", bottom: 26, left: 24, zIndex: 20, height: 32, fontSize: 16, padding: "0 12px" }}>
        Show my camera
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 26, left: 24, zIndex: 20,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: 176, height: 132, objectFit: "cover",
          borderRadius: 12,
          border: "1px solid var(--line)",
          transform: "scaleX(-1)", /* mirror, like looking in a mirror */
          background: "var(--surface)",
          boxShadow: "0 8px 24px rgba(6,8,14,0.5)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", letterSpacing: "0.05em" }}>
          Your camera. Only you see this.
        </span>
        <button onClick={() => setHidden(true)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)",
            textDecoration: "underline", padding: 0,
          }}>
          hide
        </button>
      </div>
    </div>
  );
}

/* Literal answer templates by question type — sentence starters, not scripts */
const ANSWER_TEMPLATES = {
  behavioral: {
    title: "Story template",
    steps: [
      ["The situation", "\"One time, at ___…\" Set the scene in one sentence."],
      ["Your job", "\"My job was to ___.\" What were you responsible for?"],
      ["What you did", "\"So I ___.\" The specific things you actually did."],
      ["The result", "\"In the end, ___.\" What happened because of it."],
      ["What you learned", "\"I learned ___.\" One sentence is enough."],
    ],
  },
  motivational: {
    title: "Why-you template",
    steps: [
      ["The spark", "\"I first got interested when ___.\""],
      ["One specific moment", "Tell one small, real story that shows it."],
      ["Why here", "\"That's why this place fits, because ___.\""],
    ],
  },
  technical: {
    title: "Technical answer template",
    steps: [
      ["Answer first", "Give the direct answer in one sentence before explaining."],
      ["Example", "\"For example, ___.\" Something you did, built, or studied."],
      ["Honest limits", "It's OK to say what you're not sure about."],
    ],
  },
  clarification: {
    title: "This question may be vague on purpose",
    steps: [
      ["It's OK to ask", "\"Could you clarify what you mean by ___?\""],
      ["Offer options", "\"Do you mean X, or Y?\""],
      ["Then answer", "Once it's clear, answer with one specific example."],
    ],
  },
};

function HintPopup({ question, situation, getIdToken, onClose }) {
  const template = ANSWER_TEMPLATES[question?.type] || ANSWER_TEMPLATES.behavioral;
  // Live, question-specific example. Falls back to the static template shape.
  const [loading, setLoading] = useState(true);
  const [example, setExample] = useState("");
  const [liveSteps, setLiveSteps] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setExample(""); setLiveSteps(null);
    (async () => {
      try {
        const token = await getIdToken?.();
        const res = await postJSON("/api/example-answer", {
          question: { text: question?.text, type: question?.type },
          situation,
        }, token);
        if (cancelled) return;
        if (res?.example) setExample(res.example);
        if (Array.isArray(res?.steps) && res.steps.length) {
          setLiveSteps(res.steps.map(s => [s.label, s.hint]));
        }
      } catch (e) {
        if (!cancelled) console.error("[hint] example fetch failed, using template:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // Re-fetch whenever the current question changes (by text)
  }, [question?.text, question?.type, situation, getIdToken]);

  const steps = liveSteps || template.steps;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(8,10,16,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 90, padding: 20,
      }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="card"
        role="dialog" aria-label="Answer help for this question"
        style={{
          background: "var(--surface)", maxWidth: 580, width: "100%",
          maxHeight: "82vh", overflowY: "auto",
          padding: "28px 30px", display: "flex", flexDirection: "column", gap: 16,
          borderTop: "2px solid var(--honey)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 24 }}>How to answer this</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ height: 40, fontSize: 15, padding: "0 16px" }}>
            Close
          </button>
        </div>

        {question?.text && (
          <p style={{ fontFamily: "var(--ui)", fontWeight: 400, fontSize: 18, color: "var(--text)", lineHeight: 1.6 }}>
            "{question.text}"
          </p>
        )}

        {/* Worked example for THIS exact question */}
        <div style={{
          padding: "16px 18px", borderRadius: 12,
          background: "var(--calm-soft)", border: "1px solid rgba(116,185,160,0.25)",
        }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--calm)", letterSpacing: "0.1em", marginBottom: 8 }}>
            AN EXAMPLE ANSWER
          </div>
          {loading ? (
            <span style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 17, color: "var(--dim)", fontStyle: "italic" }}>
              Writing an example for this question…
            </span>
          ) : example ? (
            <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, color: "var(--text)", lineHeight: 1.7 }}>
              {example}
            </p>
          ) : (
            <span style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 17, color: "var(--dim)" }}>
              Use the steps below to build your own answer.
            </span>
          )}
        </div>

        {/* Step structure for this question */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--honey)", letterSpacing: "0.1em" }}>
            WHAT A FULL ANSWER INCLUDES
          </div>
          {steps.map(([label, text], i) => (
            <div key={i} style={{
              display: "flex", gap: 14, alignItems: "flex-start",
              padding: "12px 16px", borderRadius: 10,
              background: "var(--raised)", border: "1px solid var(--line)",
            }}>
              <span style={{
                fontFamily: "var(--mono)", fontSize: 15, color: "var(--honey)",
                flexShrink: 0, width: 140, lineHeight: 1.55,
              }}>
                {label}
              </span>
              <span style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 17, color: "var(--text-2)", lineHeight: 1.65 }}>
                {text}
              </span>
            </div>
          ))}
        </div>

        <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 15, color: "var(--dim)", lineHeight: 1.6 }}>
          This is a shape to copy, not a script. Swap in your own real details.
        </p>
      </motion.div>
    </motion.div>
  );
}

const TIME_LIMIT = 60;

function CountdownRing({ seconds, total = TIME_LIMIT }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - seconds / total);
  const color = seconds > 15 ? "var(--calm)" : "var(--honey)";
  return (
    <div style={{ position: "relative", width: 42, height: 42, flexShrink: 0 }}>
      <svg width="42" height="42" style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}>
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
        <motion.circle cx="21" cy="21" r={r} fill="none"
          stroke={color} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={circ}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: "linear" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 15, color, lineHeight: 1 }}>{seconds}</span>
      </div>
    </div>
  );
}

export default function VoiceSession({ sessionData, situation, onEndSession, getIdToken, timedMode = false }) {
  const [history, setHistory] = useState([]);
  const [currentPersona, setCurrentPersona] = useState(null);
  const [displayLine, setDisplayLine] = useState("");
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [questionNum, setQuestionNum] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null); // { text, parts, type, index }
  const [showHint, setShowHint] = useState(false);

  const countdownRef = useRef(null);
  const transcriptRef = useRef(null);
  const currentAudio = useRef(null);
  const historyRef = useRef([]);
  const questionIndexRef = useRef(0);
  const isAISpeakingRef = useRef(false);
  const sessionCompleteRef = useRef(false);
  const isBusyRef = useRef(false);
  const hasInitRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const audioResolveRef = useRef(null);

  // Communication-profile instrumentation — derived turn timing/word data
  // only, never audio itself. See backend/lib/communicationProfileStore.js.
  const turnMetricsRef = useRef([]);
  const followupIndexRef = useRef(0);
  const interruptionsPendingRef = useRef(0);
  const extendTimeUsedRef = useRef(false);

  const [cameraNote, setCameraNote] = useState("");
  const tracking = useMultimodalTracking();
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  const signalDataRef = useRef(null);

  const personas = sessionData?.personas || [];
  // Non-evaluative modules (conversation, networking, …) always get a null
  // tone/supportLevel from the architect (see backend/modules/*.js
  // `evaluative` flag) — reuse that signal instead of hardcoding "conversation"
  // so any current or future non-evaluative module behaves the same way here.
  const isConvo = !sessionData?.tone;
  const sessionTone = sessionData?.tone || "neutral";
  const supportLevel = sessionData?.supportLevel || "guided";
  // Visible written questions are a research-backed accommodation (Bath);
  // "realistic" mode fades this scaffold for transfer practice
  const showQuestionCard = !isConvo && supportLevel !== "realistic";
  const totalQuestions = sessionData?.sessionPlan?.questions?.length || 0;
  const activePersona = personas.find(p => p.name === currentPersona) || personas[0];

  const sendTurn = useCallback(async (spokenText) => {
    if (isBusyRef.current || sessionCompleteRef.current || sessionEndedRef.current) return;
    isBusyRef.current = true;
    isAISpeakingRef.current = true;
    setIsAISpeaking(true);

    let fullLine = "";
    let resPersona = null;
    let resVoiceId = null;
    let resVoiceSettings = null;
    let resQuestionType = null;
    let resQuestionIndex = null;
    let resSessionAdvancing = false;

    try {
      const token = await getIdToken();
      await streamFetch("/api/voice-turn", {
        transcript: spokenText,
        sessionContext: JSON.stringify(sessionData),
        history: historyRef.current,
        currentQuestionIndex: questionIndexRef.current,
      }, chunk => {
        if (chunk.error) { console.error("voice-turn error:", chunk.error); return; }
        if (chunk.chunk) { fullLine += chunk.chunk; setDisplayLine(fullLine); }
        if (chunk.persona) { resPersona = chunk.persona; resVoiceId = chunk.voiceId; resVoiceSettings = chunk.voiceSettings; setCurrentPersona(chunk.persona); }
        // Keep only the TYPE from the plan (for the template category). The
        // question TEXT shown must be what the persona ACTUALLY asks, set below.
        if (chunk.question) { resQuestionType = chunk.question.type; resQuestionIndex = chunk.question.index; }
        if (chunk.done) {
          resSessionAdvancing = !!chunk.sessionAdvancing;
          if (chunk.sessionAdvancing) {
            questionIndexRef.current += 1;
            setQuestionNum(questionIndexRef.current);
            followupIndexRef.current = 0;
          }
          if (chunk.sessionComplete) { sessionCompleteRef.current = true; setSessionComplete(true); }
        }
      }, token);

      if (!fullLine.trim()) {
        isAISpeakingRef.current = false;
        isBusyRef.current = false;
        setIsAISpeaking(false);
        if (!sessionCompleteRef.current && !sessionEndedRef.current && !isListening) {
          setTimeout(() => { if (!sessionEndedRef.current && !sessionCompleteRef.current) start(); }, 400);
        }
        return;
      }

      // questionIndex/isAdvancing let the backend replay history to derive
      // branch/follow-up state statelessly (see judgeOrchestrator.js
      // deriveQuestionState) instead of dividing by a fixed turns-per-question
      // constant, now that follow-up depth varies with branching.
      const aiTurn = {
        speaker: resPersona || "Panel", text: fullLine, timestamp: Date.now(),
        questionIndex: resQuestionIndex, isAdvancing: resSessionAdvancing,
      };
      historyRef.current = [...historyRef.current, aiTurn];
      setHistory([...historyRef.current]);

      // The card + template must reflect what was ACTUALLY asked, not the plan
      setCurrentQuestion({ text: fullLine.trim(), type: resQuestionType || "behavioral" });

      const audio = await speakText({
        text: fullLine,
        voiceId: resVoiceId,
        stability: resVoiceSettings?.stability ?? 0.38,
        similarityBoost: resVoiceSettings?.similarityBoost ?? 0.85,
      });
      if (audio && typeof audio.play === "function") {
        currentAudio.current = audio;
        await new Promise(res => {
          // "Respond now" (interruption control) resolves this early via
          // audioResolveRef instead of waiting for natural playback end.
          audioResolveRef.current = res;
          audio.onended = res;
          audio.onerror = res;
          audio.play().catch(res);
        });
        audioResolveRef.current = null;
      }
      setDisplayLine("");
    } catch (e) {
      console.error("sendTurn error:", e);
    }

    isAISpeakingRef.current = false;
    isBusyRef.current = false;
    setIsAISpeaking(false);

    if (!sessionCompleteRef.current && !sessionEndedRef.current && !isListening) {
      setTimeout(() => { if (!sessionEndedRef.current && !sessionCompleteRef.current) start(); }, 400);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionData, getIdToken]);

  const { start, stop, isListening, isProcessing, micError, analyserRef, requestMoreTime } = useElevenLabsSTT({
    onResult: async (spokenText, timing) => {
      if (isAISpeakingRef.current || isBusyRef.current || sessionCompleteRef.current || sessionEndedRef.current || !spokenText?.trim()) return;

      // Turn-metric instrumentation for the communication profile — derived
      // from STT timing + word count only, never audio itself.
      if (timing) {
        const { recordingStartedAt, speechStartedAt, lastSpeechAt } = timing;
        const words = spokenText.trim().split(/\s+/).filter(Boolean).length;
        const latencySec = Number.isFinite(speechStartedAt) && Number.isFinite(recordingStartedAt)
          ? Math.max(0, (speechStartedAt - recordingStartedAt) / 1000) : null;
        const answerDurationSec = Number.isFinite(lastSpeechAt) && Number.isFinite(speechStartedAt)
          ? Math.max(0, (lastSpeechAt - speechStartedAt) / 1000) : null;
        const paceWpm = answerDurationSec && answerDurationSec > 2 ? words / (answerDurationSec / 60) : null;
        turnMetricsRef.current.push({
          questionIndex: questionIndexRef.current,
          questionType: currentQuestion?.type || null,
          followupIndex: followupIndexRef.current,
          words,
          latencySec,
          answerDurationSec,
          paceWpm,
          fillerCount: countFillerWords(spokenText),
          interruptions: interruptionsPendingRef.current,
        });
        interruptionsPendingRef.current = 0;
        followupIndexRef.current += 1;
      }

      const userTurn = { speaker: "You", text: spokenText, timestamp: Date.now() };
      historyRef.current = [...historyRef.current, userTurn];
      setHistory([...historyRef.current]);
      await sendTurn(spokenText);
    },
    // Long default threshold: thinking pauses are normal and never cut off
    silenceThresholdMs: timedMode ? 70000 : 5000,
  });

  // "Respond now" — the interruption control. Stops TTS playback immediately
  // and lets the mic re-arm via sendTurn's existing post-playback flow, so the
  // user can cut off a persona re-explaining something they already
  // understood. Each use is counted (interruption_count metric), never judged.
  const handleRespondNow = useCallback(() => {
    if (!isAISpeakingRef.current) return;
    interruptionsPendingRef.current += 1;
    if (currentAudio.current) currentAudio.current.pause();
    audioResolveRef.current?.();
    audioResolveRef.current = null;
  }, []);

  // "I need more time" — the pause/extend-time pacing control. Doubles the
  // silence threshold for the current answer only; usage feeds the
  // prefers_longer_thinking_time signal. Branching (Feature 4) never gates on
  // or overrides this.
  const handleNeedMoreTime = useCallback(() => {
    extendTimeUsedRef.current = true;
    requestMoreTime();
  }, [requestMoreTime]);

  const handleBegin = useCallback(async (withCamera = false) => {
    if (hasInitRef.current) return;
    hasInitRef.current = true;
    try {
      const ctx = new AudioContext();
      ctx.resume().then(() => ctx.close());
    } catch { /* audio unlock is best-effort */ }
    if (withCamera) {
      const ok = await trackingRef.current.enable();
      if (!ok) setCameraNote("Camera unavailable. Continuing voice-only; your session works exactly the same.");
    }
    setSessionStarted(true);
    sendTurn("");
  }, [sendTurn]);

  // Stop all audio + mic + camera when component unmounts
  useEffect(() => {
    return () => {
      sessionEndedRef.current = true;
      stop();
      stopAllAudio();
      trackingRef.current.end();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [history]);

  // Timed pressure countdown
  useEffect(() => {
    if (!timedMode) return;
    if (isListening) {
      setCountdown(TIME_LIMIT);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            stop();
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(countdownRef.current);
      setCountdown(null);
    }
    return () => clearInterval(countdownRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, timedMode]);

  const handleEnd = () => {
    sessionEndedRef.current = true;
    isBusyRef.current = true;
    stop();

    // Collect derived tracking signals (numbers only; video was never stored)
    if (signalDataRef.current === null) signalDataRef.current = trackingRef.current.end();

    const doEnd = () => onEndSession({
      history, sessionData, situation,
      signalData: signalDataRef.current?.length ? signalDataRef.current : null,
      turnMetrics: turnMetricsRef.current,
      extendTimeUsed: extendTimeUsedRef.current,
    });

    if (currentAudio.current && !currentAudio.current.ended && !currentAudio.current.paused) {
      const timeout = setTimeout(() => {
        if (currentAudio.current) { currentAudio.current.pause(); currentAudio.current = null; }
        doEnd();
      }, 6000);
      currentAudio.current.onended = () => { clearTimeout(timeout); doEnd(); };
      currentAudio.current.onerror = () => { clearTimeout(timeout); doEnd(); };
    } else {
      if (currentAudio.current) { currentAudio.current.pause(); currentAudio.current = null; }
      doEnd();
    }
  };

  /* ── PANEL INTRO ── */
  if (!sessionStarted) {
    return (
      <motion.div className="screen screen-scroll" variants={sv} initial="initial" animate="animate" exit="exit"
        style={{ background: "var(--ink)" }}>
        <div className="noise" />
        <div className="ambient" />

        <div style={{
          position: "relative", zIndex: 1, minHeight: "100%",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "72px 28px 48px", maxWidth: 1120, margin: "0 auto", gap: 34, width: "100%",
        }}>
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{ textAlign: "center", maxWidth: 560 }}
          >
            <h1 style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: "clamp(38px, 6vw, 56px)", lineHeight: 1.15, marginBottom: 10 }}>
              {isConvo ? "Meet your conversation partner." : "Meet your panel."}
            </h1>
            <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 20, color: "var(--dim)", lineHeight: 1.7 }}>
              {isConvo
                ? "Relaxed. No evaluation. End anytime."
                : totalQuestions
                ? `${totalQuestions} questions, one at a time.`
                : "One question at a time."}
            </p>
            {!isConvo && sessionTone && (
              <p style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--honey)", letterSpacing: "0.05em", marginTop: 10 }}>
                Tone: {sessionTone.charAt(0).toUpperCase() + sessionTone.slice(1)}
                {sessionTone === "challenging" && ". Interviewers may be more direct and less accommodating."}
                {sessionTone === "supportive" && ". Interviewers will be warm and encouraging."}
              </p>
            )}
            {!isConvo && (
              <p style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--calm)", letterSpacing: "0.05em", marginTop: 4 }}>
                Support: {supportLevel.charAt(0).toUpperCase() + supportLevel.slice(1)}
              </p>
            )}
          </motion.div>

          {/* Panel assembly — names only, big */}
          <div className="persona-grid" style={{
            "--cols": personas.length <= 3 ? personas.length : Math.ceil(personas.length / 2),
            maxWidth: personas.length === 4 ? 860 : 1040,
            gap: 18,
          }}>
            {personas.map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -4 }}
                className="card"
                style={{
                  padding: "40px 20px 28px", minHeight: 170,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
                  borderTop: `4px solid ${p.color}`, textAlign: "center",
                }}
              >
                <div style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: "clamp(26px, 2.6vw, 34px)", lineHeight: 1.2, color: "var(--text)" }}>
                  {p.name}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--dim)", opacity: 0.75 }}>
                  Fictional, not a real person
                </div>
              </motion.div>
            ))}
          </div>

          {/* Camera consent — clear, optional, voice-only always works */}
          <motion.div
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + personas.length * 0.12, duration: 0.5 }}
            className="card"
            style={{ padding: "22px 26px", maxWidth: 860, width: "100%", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.12em" }}>
              OPTIONAL: CAMERA TRACKING
            </div>
            <p style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 18, color: "var(--text-2)", lineHeight: 1.7 }}>
              Tracks posture, head tilt, and mouth movement, on your device only.
              Never stored. Never judged live. You choose what appears in your debrief.
            </p>
            {tracking.status === "denied" && (
              <p style={{ fontFamily: "var(--ui)", fontSize: 18, color: "var(--dim)", lineHeight: 1.6 }}>
                Camera access declined. No problem: your session runs voice-only and the debrief simply skips tracking sections.
              </p>
            )}
            {cameraNote && (
              <p style={{ fontFamily: "var(--ui)", fontSize: 18, color: "var(--dim)", lineHeight: 1.6 }}>{cameraNote}</p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <button className="btn btn-primary" onClick={() => handleBegin(true)}
                disabled={tracking.status === "starting"}
                style={{ padding: "0 22px", fontSize: 19 }}>
                {tracking.status === "starting" ? "Starting camera…" : "Begin with camera"}
              </button>
              <button className="btn btn-ghost" onClick={() => handleBegin(false)}
                style={{ height: 50, padding: "0 22px", fontSize: 19 }}>
                Begin voice-only
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  /* ── ACTIVE SESSION ── */
  const personaColor = activePersona?.color || "var(--honey)";

  return (
    <motion.div className="screen" variants={sv} initial="initial" animate="animate" exit="exit"
      style={{ background: "var(--ink)" }}>
      <div className="noise" />

      <div style={{
        position: "relative", zIndex: 1,
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", padding: "76px 20px 108px",
        maxWidth: 680, margin: "0 auto", width: "100%", gap: 18,
      }}>

        {/* Status line — camera note wraps below so it never sits under the banner */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, alignSelf: "stretch", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: isConvo ? "var(--calm)" : "var(--dim)", letterSpacing: "0.16em" }}>
            {isConvo ? "OPEN CONVERSATION · NO EVALUATION" : "LIVE SESSION"}
          </span>
          {tracking.isTracking && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.08em", opacity: 0.7 }}>
              CAMERA ON · PRIVATE · NO LIVE FEEDBACK
            </span>
          )}
        </div>

        {/* The Panel Rail */}
        <PanelRail personas={personas} activeName={activePersona?.name} speaking={isAISpeaking} />

        {/* Active persona identity */}
        <AnimatePresence mode="wait">
          <motion.div key={currentPersona}
            initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            style={{ textAlign: "center" }}
          >
            <div style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 25, marginBottom: 2 }}>
              {activePersona?.name || "Panel"}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: personaColor, letterSpacing: "0.05em", opacity: 0.9 }}>
              {activePersona?.role || ""}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", marginTop: 5, opacity: 0.7 }}>
              Simulated interviewer. Fictional, not a real person.
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Question rail — always know where you are (interview mode only) */}
        {!isConvo && <QuestionRail total={totalQuestions} current={questionNum} complete={sessionComplete} />}

        {/* Persistent written question — stays visible while you think and answer */}
        <AnimatePresence mode="wait">
          {showQuestionCard && currentQuestion?.text && !sessionComplete && (
            <motion.div
              key={currentQuestion.text.slice(0, 24)}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              style={{
                width: "100%", padding: "14px 18px",
                background: "var(--raised)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", letterSpacing: "0.14em" }}>
                  CURRENT QUESTION
                </span>
                <button
                  onClick={() => setShowHint(true)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                    background: "var(--honey-soft)", border: "1px solid rgba(228,163,57,0.4)",
                    fontFamily: "var(--ui)", fontSize: 15, color: "var(--honey)",
                    transition: "all 0.2s",
                  }}
                >
                  Show me a template
                </button>
              </div>
              <div style={{ fontFamily: "var(--ui)", fontWeight: 400, fontSize: 20, lineHeight: 1.6, color: "var(--text)" }}>
                {currentQuestion.text}
              </div>
              {supportLevel === "guided" && (
                <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 15, color: "var(--dim)", opacity: 0.8 }}>
                  Unsure what they mean? Asking them to clarify is always OK.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current spoken line */}
        <AnimatePresence mode="wait">
          {displayLine && (
            <motion.div
              key={displayLine.slice(0, 20)}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{
                padding: "16px 20px", width: "100%",
                fontSize: 21, lineHeight: 1.75,
                fontFamily: "var(--ui)", fontWeight: 300,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderLeft: `3px solid ${personaColor}`,
                borderRadius: "var(--radius)",
              }}
            >
              {displayLine}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mic waveform while user speaks */}
        <AnimatePresence>
          {isListening && !isAISpeaking && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
            >
              <MicWaveform active={isListening} analyserRef={analyserRef} />
              <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.12em", opacity: 0.8 }}>
                LISTENING. TAKE YOUR TIME.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mic error */}
        <AnimatePresence>
          {micError && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 10,
                background: "rgba(217,139,139,0.07)", border: "1px solid rgba(217,139,139,0.25)",
                fontFamily: "var(--mono)", fontSize: 16, color: "var(--alert)",
              }}
            >
              {micError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transcript */}
        <div
          ref={transcriptRef}
          aria-live="polite"
          style={{
            flex: 1, width: "100%", overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 14,
            scrollbarWidth: "none",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 10%)",
            paddingTop: 6,
          }}
        >
          {history.map((turn, i) => {
            const p = personas.find(x => x.name === turn.speaker);
            const isUser = turn.speaker === "You";
            const isLast = i === history.length - 1;
            const tColor = isUser ? "var(--calm)" : (p?.color || "var(--honey)");
            return (
              <motion.div key={i}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span style={{ fontFamily: "var(--mono)", fontSize: 15, letterSpacing: "0.1em", color: tColor }}>
                  {turn.speaker.toUpperCase()}
                </span>
                <span style={{
                  fontSize: 19, fontFamily: "var(--ui)", fontWeight: 300,
                  color: "var(--text)", lineHeight: 1.65,
                  opacity: isLast ? 1 : 0.5,
                  transition: "opacity 0.3s",
                }}>
                  {turn.text}
                </span>
              </motion.div>
            );
          })}

          <AnimatePresence>
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span style={{ fontFamily: "var(--mono)", fontSize: 15, letterSpacing: "0.1em", color: "var(--calm)" }}>YOU</span>
                <span style={{ fontSize: 19, color: "var(--text)", lineHeight: 1.65, opacity: 0.45, fontStyle: "italic" }}>
                  Writing down what you said…
                  <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }}>|</motion.span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom status bar */}
      <div style={{
        position: "fixed", bottom: 30, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 10, zIndex: 20,
      }}>
        <AnimatePresence>
          {(isListening || isProcessing) && (
            <motion.button
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              onClick={() => !isProcessing && stop()}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--calm-soft)",
                border: "1px solid rgba(116,185,160,0.3)",
                borderRadius: 999, padding: "10px 20px",
                color: "inherit", cursor: "pointer",
              }}
            >
              <span className="dot" style={{ background: "var(--calm)", width: 5, height: 5 }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--calm)", letterSpacing: "0.07em" }}>
                {isProcessing ? "TRANSCRIBING" : "LISTENING. TAP WHEN DONE."}
              </span>
              {timedMode && countdown !== null && <CountdownRing seconds={countdown} />}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Pacing control: extend thinking time for this answer, no limit on uses */}
        <AnimatePresence>
          {isListening && !isProcessing && (
            <motion.button
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              onClick={(e) => { e.stopPropagation(); handleNeedMoreTime(); }}
              className="btn btn-ghost"
              style={{ height: 40, fontSize: 15, padding: "0 16px", borderRadius: 999 }}
            >
              I need more time
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isAISpeaking && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--honey-soft)",
                border: "1px solid rgba(228,163,57,0.3)",
                borderRadius: 999, padding: "10px 20px",
              }}
            >
              <span className="dot" style={{ background: "var(--honey)", width: 5, height: 5 }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--honey)", letterSpacing: "0.07em" }}>
                {(activePersona?.name || "PANEL").split(/\s+/)[0].toUpperCase()} IS SPEAKING
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Interruption control: cut off a persona re-explaining something
            already understood, rather than waiting out the full line */}
        <AnimatePresence>
          {isAISpeaking && (
            <motion.button
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              onClick={(e) => { e.stopPropagation(); handleRespondNow(); }}
              className="btn btn-ghost"
              style={{ height: 40, fontSize: 15, padding: "0 16px", borderRadius: 999 }}
            >
              Respond now
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Answer-template popup — user-initiated, never automatic */}
      <AnimatePresence>
        {showHint && (
          <HintPopup question={currentQuestion} situation={situation} getIdToken={getIdToken} onClose={() => setShowHint(false)} />
        )}
      </AnimatePresence>

      {/* Realistic mode has no question card, so the hint lives next to End session */}
      {!isConvo && supportLevel === "realistic" && currentQuestion && (
        <button className="btn btn-ghost" onClick={() => setShowHint(true)}
          style={{ position: "fixed", bottom: 26, right: 190, zIndex: 20, height: 42, fontSize: 15, padding: "0 16px" }}>
          Show me a template
        </button>
      )}

      {/* Self-view camera mirror (only when camera tracking is on) */}
      <SelfView stream={tracking.previewStream} />

      {/* End session button */}
      <button className="btn btn-ghost" onClick={() => setShowConfirm(true)}
        style={{ position: "fixed", bottom: 26, right: 24, zIndex: 20, height: 36, fontSize: 17, padding: "0 16px" }}>
        {isConvo ? "End conversation" : "End session"}
      </button>

      {/* Session complete overlay */}
      <AnimatePresence>
        {sessionComplete && !showConfirm && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{
              position: "fixed", bottom: 82, left: "50%", transform: "translateX(-50%)",
              background: "var(--calm-soft)",
              border: "1px solid rgba(116,185,160,0.35)",
              borderRadius: 12, padding: "12px 20px",
              zIndex: 20, display: "flex", alignItems: "center", gap: 12,
            }}
          >
            <span style={{ color: "var(--calm)", fontSize: 18 }}>✓</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--calm)", letterSpacing: "0.06em" }}>
              Session complete
            </span>
            <button className="btn btn-primary" onClick={handleEnd}
              style={{ height: 32, fontSize: 17, padding: "0 14px", borderRadius: 8 }}>
              See your debrief
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm modal */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0, background: "rgba(8,10,16,0.85)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 100,
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 18 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="card"
              style={{
                background: "var(--surface)",
                padding: 36, maxWidth: 360, width: "90%",
                display: "flex", flexDirection: "column", gap: 20, textAlign: "center",
              }}
            >
              <div>
                <div style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 27, marginBottom: 10 }}>
                  {isConvo ? "End the conversation?" : "End the session?"}
                </div>
                <div style={{ fontFamily: "var(--ui)", fontWeight: 300, fontSize: 19, color: "var(--dim)", lineHeight: 1.7 }}>
                  {isConvo
                    ? "You'll get a short optional recap and your transcript. No evaluation."
                    : "You'll get a private debrief: your panel's impressions and your full transcript. No scores."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" onClick={handleEnd} style={{ flex: 1, fontSize: 19 }}>
                  {isConvo ? "End conversation" : "End session"}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowConfirm(false)} style={{ flex: 1, height: 50 }}>Keep going</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
