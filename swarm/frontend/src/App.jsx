import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import Coach from "./components/Coach";
import SituationInput from "./components/SituationInput";
import ModeSelect from "./components/ModeSelect";
import PeerSession from "./components/PeerSession";
import MissionControl from "./components/MissionControl";
import VoiceSession from "./components/VoiceSession";
import Debrief from "./components/Debrief";
import AskSwarm from "./components/AskSwarm";
import Dashboard from "./components/Dashboard";
import ProgressView from "./components/ProgressView";
import SignIn from "./components/SignIn";
import ProfileSetup from "./components/ProfileSetup";
import { stopAllAudio } from "./hooks/useVoiceOutput";
import { getJSON } from "./lib/api";

const SCREENS = {
  COACH:           "COACH",
  DASHBOARD:       "DASHBOARD",
  PROGRESS:        "PROGRESS",
  PROFILE:         "PROFILE",
  MODE_SELECT:     "MODE_SELECT",
  PEER:            "PEER",
  SITUATION_INPUT: "SITUATION_INPUT",
  MISSION_CONTROL: "MISSION_CONTROL",
  VOICE_SESSION:   "VOICE_SESSION",
  DEBRIEF:         "DEBRIEF",
  ASK_SWARM:       "ASK_SWARM",
};

/* Persistent product identity — visible on every page. Sits in its own
   opaque pill so it never visually merges with content behind it. */
function ForASDBanner() {
  return (
    <div aria-label="This app is built for autistic people" style={{
      position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
      zIndex: 999, pointerEvents: "none",
      padding: "6px 22px", borderRadius: 999,
      background: "color-mix(in srgb, var(--ink) 82%, transparent)",
      border: "1px solid var(--line)",
      backdropFilter: "blur(8px)",
    }}>
      <span style={{
        fontFamily: "var(--display)", fontWeight: 600,
        fontSize: "clamp(22px, 2.6vw, 32px)", lineHeight: 1,
        letterSpacing: "0.14em",
        background: "linear-gradient(135deg, #E4A339 0%, #EFC272 55%, #74B9A0 100%)",
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        whiteSpace: "nowrap",
      }}>
        FOR ASD
      </span>
    </div>
  );
}

const THEME_KEY = "swarm_sensory_mode";
const THEMES = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Soft light" },
  { key: "plain", label: "Plain text" },
];

/* Sensory controls — always fixed top-right, literal text labels, one click
   per mode. Persists across sessions. */
function SensoryControls({ theme, onChange }) {
  return (
    <div role="group" aria-label="Sensory controls"
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: 4, borderRadius: 999,
        background: "var(--surface)", border: "1px solid var(--line)",
      }}>
      {THEMES.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} aria-pressed={theme === t.key}
          style={{
            padding: "6px 14px", borderRadius: 999, cursor: "pointer", border: "none",
            background: theme === t.key ? "var(--honey-soft)" : "transparent",
            color: theme === t.key ? "var(--honey)" : "var(--dim)",
            fontFamily: "var(--ui)", fontSize: 14.5, fontWeight: 500,
            transition: "all 0.15s",
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function decodeJwt(jwt) {
  try {
    const base64Url = jwt.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("google_id_token"));
  const [screen, setScreen] = useState(SCREENS.COACH);
  const [situation, setSituation] = useState("");
  const [intent, setIntent] = useState(null);
  const [mode, setMode] = useState("interview");      // interview | conversation
  const [tone, setTone] = useState("neutral");        // supportive | neutral | challenging
  const [supportLevel, setSupportLevel] = useState("guided"); // guided | standard | realistic
  const [sessionData, setSessionData] = useState(null);
  const [sessionResult, setSessionResult] = useState(null);
  const [debriefResult, setDebriefResult] = useState(null);
  const [timedMode, setTimedMode] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [profileSet, setProfileSet] = useState(null);   // null = unknown, false = never set, true = set/dismissed
  const [pendingMode, setPendingMode] = useState(null); // mode to resume after first-time profile setup
  const [moduleMeta, setModuleMeta] = useState({});     // key -> { evaluative, skipResearch, implemented, label }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const legacyScript = document.querySelector("script[src='https://accounts.google.com/gsi/client']");
    if (legacyScript) { setGoogleReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  const handleCredentialResponse = useCallback((response) => {
    if (!response?.credential) return;
    const payload = decodeJwt(response.credential);
    if (!payload) return;
    localStorage.setItem("google_id_token", response.credential);
    setToken(response.credential);
    setUser(payload);
  }, []);

  // Restore session from localStorage on load
  useEffect(() => {
    if (!token) return;
    const payload = decodeJwt(token);
    if (payload) {
      setUser(payload);
    } else {
      localStorage.removeItem("google_id_token");
      setToken(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignOut = () => {
    window.google?.accounts?.id?.disableAutoSelect?.();
    localStorage.removeItem("google_id_token");
    setToken(null);
    setUser(null);
  };

  const getIdToken = useCallback(async () => token, [token]);

  // Learn whether this user has set their communication profile yet, so we can
  // prompt for it once before their first session.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { profile } = await getJSON("/api/profile", token);
        if (!cancelled) setProfileSet(!!profile?.set);
      } catch {
        if (!cancelled) setProfileSet(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, token]);

  // Module registry, fetched once — lets SituationInput/MissionControl adapt
  // generically (evaluative vs not, research vs not) to any module the
  // backend defines, instead of hardcoding `mode === "conversation"`.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { modules } = await getJSON("/api/modules", token);
        if (!cancelled && Array.isArray(modules)) {
          setModuleMeta(Object.fromEntries(modules.map(m => [m.key, m])));
        }
      } catch {
        /* SituationInput/MissionControl fall back to mode === "conversation" */
      }
    })();
    return () => { cancelled = true; };
  }, [user, token]);

  const handleNewSession = () => { stopAllAudio(); setScreen(SCREENS.MODE_SELECT); };

  const proceedToMode = (selected) => {
    setMode(selected);
    setTone("neutral"); // never default a new session into the harshest setting
    setScreen(SCREENS.SITUATION_INPUT);
  };

  const handleModeSelect = (selected) => {
    stopAllAudio();
    if (selected === "peer") { setScreen(SCREENS.PEER); return; }
    // First-ever interview/conversation: set up the personal profile first.
    if (profileSet === false) {
      setPendingMode(selected);
      setScreen(SCREENS.PROFILE);
      return;
    }
    proceedToMode(selected);
  };

  const openProfile = () => { stopAllAudio(); setPendingMode(null); setScreen(SCREENS.PROFILE); };

  const handleProfileDone = () => {
    setProfileSet(true);
    const resume = pendingMode;
    setPendingMode(null);
    if (resume) proceedToMode(resume);
    else setScreen(SCREENS.COACH);
  };

  const handleProfileSkip = () => {
    setProfileSet(true); // dismissed for now; server profile stays unset until they fill it
    const resume = pendingMode;
    setPendingMode(null);
    if (resume) proceedToMode(resume);
    else setScreen(SCREENS.COACH);
  };

  const handleLaunch = (sit, opts = {}) => {
    stopAllAudio();
    setSituation(sit);
    setIntent(opts.intent || null);
    setTone(opts.tone || "neutral");
    setSupportLevel(opts.supportLevel || "guided");
    setTimedMode(opts.timedMode || false);
    setScreen(SCREENS.MISSION_CONTROL);
  };

  const handleBeginSession = (data) => {
    stopAllAudio();
    setSessionData(data);
    setScreen(SCREENS.VOICE_SESSION);
  };

  const handleEndSession = (result) => {
    stopAllAudio();
    setSessionResult(result);
    setScreen(SCREENS.DEBRIEF);
  };

  const handleAskSwarm = (debrief) => {
    stopAllAudio();
    setDebriefResult(debrief);
    setScreen(SCREENS.ASK_SWARM);
  };

  // "Practice this now" (Feature 3) — reopens a mini-session for just one
  // practice_prompt, reusing the original session's personas/mode/tone/
  // supportLevel entirely client-side. Zero LLM calls: skips intent parsing,
  // research, and persona generation completely, unlike a normal new session.
  const handlePracticeThisNow = (practicePrompt) => {
    const base = sessionResult?.sessionData;
    if (!base || !practicePrompt) return;
    stopAllAudio();
    setSessionData({
      ...base,
      sessionPlan: {
        ...base.sessionPlan,
        questions: [{ text: practicePrompt, type: "behavioral", assignedPersona: base.personas?.[0]?.name || null }],
        totalEstimatedMinutes: 5,
      },
    });
    setSessionResult(null);
    setDebriefResult(null);
    setScreen(SCREENS.VOICE_SESSION);
  };

  const handleRunAgain = () => {
    stopAllAudio();
    setSituation((s) => s.replace(", harder this time", "") + ", harder this time");
    setSessionData(null);
    setSessionResult(null);
    setDebriefResult(null);
    setScreen(SCREENS.SITUATION_INPUT);
  };

  // The coach is home now (Feature 1) — "back" from any screen returns here,
  // not to the session-history dashboard.
  const handleBackToHome = () => {
    stopAllAudio();
    setScreen(SCREENS.COACH);
  };

  // Coach's free-form box (Feature 1): the user describes what they actually
  // need in their own words, and the coach builds a drill around it on the
  // fly via the `custom` module — bypasses ModeSelect/SituationInput's preset
  // flow entirely, same short-circuit pattern as handlePracticeThisNow.
  const handleFreeformLaunch = (text) => {
    setMode("custom");
    setTone("neutral");
    setSupportLevel("guided");
    handleLaunch(text, { tone: "neutral", supportLevel: "guided" });
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "var(--ink)" }}>
      <ForASDBanner />

      {user && screen !== SCREENS.COACH && (
        <button
          onClick={handleBackToHome}
          style={{
            position: "fixed", left: 20, top: 20, zIndex: 1000,
            padding: "6px 14px", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--muted)", cursor: "pointer",
            fontFamily: "var(--mono)", fontSize: "16px",
            letterSpacing: "0.04em", transition: "all 0.18s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "var(--muted)"; }}
        >
          ← Home
        </button>
      )}

      {!user && (
        <div style={{ position: "fixed", right: 20, top: 20, zIndex: 1000 }}>
          <SensoryControls theme={theme} onChange={setTheme} />
        </div>
      )}

      {user && (
        <div style={{ position: "fixed", right: 20, top: 20, zIndex: 1000, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <SensoryControls theme={theme} onChange={setTheme} />
          {user.picture && (
            <img src={user.picture} alt="" width={28} height={28} referrerPolicy="no-referrer"
              style={{ borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)" }} />
          )}
          <span style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: "16px", letterSpacing: "0.03em" }}>
            {user.name || user.email}
          </span>
          <button onClick={openProfile}
            style={{
              padding: "6px 14px", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--muted)", cursor: "pointer",
              fontFamily: "var(--mono)", fontSize: "16px",
              transition: "all 0.18s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "var(--muted)"; }}
          >
            Profile
          </button>
          <button onClick={handleSignOut}
            style={{
              padding: "6px 14px", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--muted)", cursor: "pointer",
              fontFamily: "var(--mono)", fontSize: "16px",
              transition: "all 0.18s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "var(--muted)"; }}
          >
            Sign out
          </button>
        </div>
      )}

      {!user ? (
        <SignIn googleReady={googleReady} onCredential={handleCredentialResponse} />
      ) : (
        <AnimatePresence mode="wait">
          {screen === SCREENS.COACH && (
            <Coach
              key="coach"
              user={user}
              getIdToken={getIdToken}
              onOpenLibrary={() => setScreen(SCREENS.MODE_SELECT)}
              onOpenProgress={() => setScreen(SCREENS.PROGRESS)}
              onOpenHistory={() => setScreen(SCREENS.DASHBOARD)}
              onFreeformLaunch={handleFreeformLaunch}
            />
          )}
          {screen === SCREENS.DASHBOARD && (
            <Dashboard key="dashboard" user={user} onNewSession={handleNewSession} onOpenProgress={() => setScreen(SCREENS.PROGRESS)} getIdToken={getIdToken} />
          )}
          {screen === SCREENS.PROGRESS && (
            <ProgressView key="progress" onBack={handleBackToHome} getIdToken={getIdToken} />
          )}
          {screen === SCREENS.PROFILE && (
            <ProfileSetup
              key="profile"
              getIdToken={getIdToken}
              isFirstTime={pendingMode !== null}
              onDone={handleProfileDone}
              onBack={handleProfileSkip}
            />
          )}
          {screen === SCREENS.MODE_SELECT && (
            <ModeSelect key="mode" onSelect={handleModeSelect} onBack={handleBackToHome} getIdToken={getIdToken} />
          )}
          {screen === SCREENS.PEER && (
            <PeerSession key="peer" getIdToken={getIdToken} onExit={handleBackToHome} />
          )}
          {screen === SCREENS.SITUATION_INPUT && (
            <SituationInput key="input" mode={mode} moduleInfo={moduleMeta[mode]} onLaunch={handleLaunch} initialSituation={situation} onBack={() => setScreen(SCREENS.MODE_SELECT)} getIdToken={getIdToken} />
          )}
          {screen === SCREENS.MISSION_CONTROL && (
            <MissionControl key="mission" situation={situation} intent={intent} mode={mode} moduleInfo={moduleMeta[mode]} tone={tone} supportLevel={supportLevel} onBeginSession={handleBeginSession} getIdToken={getIdToken} />
          )}
          {screen === SCREENS.VOICE_SESSION && (
            <VoiceSession key="session" sessionData={sessionData} situation={situation} onEndSession={handleEndSession} getIdToken={getIdToken} timedMode={timedMode} />
          )}
          {screen === SCREENS.DEBRIEF && (
            <Debrief key="debrief" sessionResult={sessionResult} situation={situation} onRunAgain={handleRunAgain} onAskSwarm={handleAskSwarm} onPracticeThisNow={handlePracticeThisNow} getIdToken={getIdToken} />
          )}
          {screen === SCREENS.ASK_SWARM && (
            <AskSwarm key="ask" sessionResult={sessionResult} situation={situation} debrief={debriefResult} onRunAgain={handleRunAgain} getIdToken={getIdToken} />
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
