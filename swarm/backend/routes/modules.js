// Exposes the module registry so the frontend's ModeSelect can render tiles
// (including disabled "coming soon" tiles for scaffolded modules) from the
// same source of truth the backend uses, instead of a hand-maintained list
// that can drift. "peer" is intentionally not included here — see
// backend/modules/index.js for why.
import { listModules } from "../modules/index.js";

export default function handler(req, res) {
  res.json({ modules: listModules() });
}
