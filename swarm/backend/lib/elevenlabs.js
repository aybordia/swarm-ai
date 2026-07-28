// Voice ID map — ElevenLabs v2 voices
// Actual audio calls happen from the frontend to avoid streaming latency
export const VOICE_IDS = {
  Rachel: "EXAVITQu4vr4xnSDxMaL",       // warm, clear, American female
  Arnold: "VR6AewLTigWG4xSOukaG",        // deep, confident male
  Josh:   "TxGEqnHWrfWFTfGW9XjX",        // analytical, dry male
  Gigi:   "jBpfuIE2acCO8z3wKNLl",        // bright, energetic female
  Adam:   "pNInz6obpgDQGcFmaJgB",        // deliberate, serious older male
};

export function resolveVoiceId(voiceTarget) {
  return VOICE_IDS[voiceTarget] ?? VOICE_IDS.Rachel; // fallback to Rachel
}

// The coach's voice is a stable relationship, not a disposable session prop —
// it must never be one of the five IDs above, since voiceDesigner.js draws
// persona voices from exactly that pool every session. Override via env var
// once a specific voice is chosen/verified in the ElevenLabs dashboard; the
// default below is a distinct premade ElevenLabs voice ("Antoni") used only
// as a placeholder until that's confirmed.
export const COACH_VOICE_ID = process.env.COACH_VOICE_ID || "ErXwobaYiN019PkySvjV";
