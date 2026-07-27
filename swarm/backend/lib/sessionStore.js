import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

// ── MongoDB (production) ─────────────────────────────────────────
let client = null;
let db     = null;
let dbFailed = false;

async function getDB() {
  if (db) return db;
  if (dbFailed) return null;
  if (!process.env.MONGODB_URI) return null;
  try {
    // Dynamic import so a missing package never crashes the server
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db("swarm");
    console.log("[db] Connected to MongoDB Atlas");
    return db;
  } catch (e) {
    dbFailed = true;
    console.error("[db] MongoDB connection failed, falling back to file storage:", e.message);
    return null;
  }
}

// ── File storage fallback (local dev) ───────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "../data/users");

function userFile(userId) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}
function fileRead(userId) {
  const f = userFile(userId);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
}
function fileWrite(userId, sessions) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(userFile(userId), JSON.stringify(sessions, null, 2), "utf8");
}

// ── Public API ───────────────────────────────────────────────────
export async function getSessions(userId) {
  const database = await getDB();
  if (database) {
    const docs = await database.collection("sessions")
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs;
  }
  return fileRead(userId).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSession(userId, { situation, history, debrief, sessionData, metricsSnapshot }) {
  const session = {
    id: crypto.randomUUID(),
    userId,
    situation,
    history:         history         || [],
    debrief:         debrief         || null,
    sessionData:     sessionData     || null,
    metricsSnapshot: metricsSnapshot || null,
    createdAt:       Date.now(),
  };

  const database = await getDB();
  if (database) {
    await database.collection("sessions").insertOne(session);
    return session;
  }
  // File fallback
  const sessions = fileRead(userId);
  sessions.push(session);
  fileWrite(userId, sessions);
  return session;
}

export async function getSession(userId, sessionId) {
  const database = await getDB();
  if (database) {
    return await database.collection("sessions").findOne({ userId, id: sessionId });
  }
  return fileRead(userId).find(s => s.id === sessionId) || null;
}
