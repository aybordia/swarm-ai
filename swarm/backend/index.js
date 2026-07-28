import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import startSession from "./routes/startSession.js";
import voiceTurn from "./routes/voiceTurn.js";
import exampleAnswer from "./routes/exampleAnswer.js";
import debrief from "./routes/debrief.js";
import querySession from "./routes/querySession.js";
import askSwarm from "./routes/askSwarm.js";
import { listSessions, saveSessionRoute, getSessionRoute } from "./routes/sessions.js";
import feedback from "./routes/feedback.js";
import parseIntentRoute from "./routes/parseIntent.js";
import { peerJoin, peerStatus, peerCancel, peerEnd, peerReport, peerBlock } from "./routes/peer.js";
import { getProfileRoute, saveProfileRoute } from "./routes/profile.js";
import modulesRoute from "./routes/modules.js";
import {
  getCommunicationProfileRoute,
  patchPreferencesRoute,
  resetPreferenceRoute,
  setUserGoalsRoute,
  confirmFocusAreaRoute,
  exportCommunicationProfileRoute,
  deleteCommunicationProfileRoute,
} from "./routes/communicationProfile.js";
import { getCoachGreetingRoute } from "./routes/coach.js";
import { verifyToken } from "./googleAuth.js";

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  /\.vercel\.app$/,
  "https://swarm-ai-ruddy.vercel.app",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some((o) => typeof o === "string" ? o === origin : o.test(origin))) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "6mb" })); // derived tracking signals can be large on long sessions

app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.post("/api/parse-intent", verifyToken, parseIntentRoute);
app.post("/api/start-session", verifyToken, startSession);
app.post("/api/voice-turn", verifyToken, voiceTurn);
app.post("/api/example-answer", verifyToken, exampleAnswer);
app.post("/api/debrief", verifyToken, debrief);
app.post("/api/query-session", verifyToken, querySession);
app.post("/api/ask-swarm", verifyToken, askSwarm);
app.get("/api/sessions", verifyToken, listSessions);
app.post("/api/sessions/save", verifyToken, saveSessionRoute);
app.get("/api/sessions/:id", verifyToken, getSessionRoute);
app.post("/api/feedback", verifyToken, feedback);
app.get("/api/profile", verifyToken, getProfileRoute);
app.post("/api/profile", verifyToken, saveProfileRoute);
app.get("/api/modules", verifyToken, modulesRoute);
app.get("/api/communication-profile", verifyToken, getCommunicationProfileRoute);
app.post("/api/communication-profile/preferences", verifyToken, patchPreferencesRoute);
app.post("/api/communication-profile/preferences/reset", verifyToken, resetPreferenceRoute);
app.post("/api/communication-profile/goals", verifyToken, setUserGoalsRoute);
app.post("/api/communication-profile/focus-area", verifyToken, confirmFocusAreaRoute);
app.get("/api/communication-profile/export", verifyToken, exportCommunicationProfileRoute);
app.post("/api/communication-profile/delete", verifyToken, deleteCommunicationProfileRoute);
app.get("/api/coach/greeting", verifyToken, getCoachGreetingRoute);
app.post("/api/peer/queue", verifyToken, peerJoin);
app.get("/api/peer/status", verifyToken, peerStatus);
app.post("/api/peer/cancel", verifyToken, peerCancel);
app.post("/api/peer/end", verifyToken, peerEnd);
app.post("/api/peer/report", verifyToken, peerReport);
app.post("/api/peer/block", verifyToken, peerBlock);

// Global error handler
app.use((err, req, res, next) => {
  console.error("[global error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Swarm backend running on :${PORT}`));
