const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;

import { useRef, useState, useCallback } from "react";

export function useElevenLabsSTT({ onResult, onSilence, silenceThresholdMs = 3000 } = {}) {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const wantListening = useRef(false);
  const silenceThresholdRef = useRef(silenceThresholdMs);

  // Turn-level timing, used to derive speaking pace / response latency
  // (communication profile instrumentation) without any new tracking infra —
  // reuses the silence-detection analyser loop that already runs every frame.
  const recordingStartRef = useRef(null);
  const speechStartRef = useRef(null);
  const lastSpeechRef = useRef(null);

  const onResultRef = useRef(onResult);
  const onSilenceRef = useRef(onSilence);
  onResultRef.current = onResult;
  onSilenceRef.current = onSilence;

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [micError, setMicError] = useState(null);

  const transcribe = useCallback(async (blob) => {
    if (!blob || blob.size < 500) return; // skip empty recordings
    setIsProcessing(true);
    try {
      // Determine extension from MIME type
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("file", blob, `audio.${ext}`);
      formData.append("model_id", "scribe_v1");

      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        body: formData,
      });

      if (res.status === 401) throw new Error("ElevenLabs API key missing or invalid.");
      if (!res.ok) throw new Error(`ElevenLabs STT error: ${res.status}`);
      const data = await res.json();
      const text = data.text?.trim();
      if (text) {
        onResultRef.current?.(text, {
          recordingStartedAt: recordingStartRef.current,
          speechStartedAt: speechStartRef.current,
          lastSpeechAt: lastSpeechRef.current,
        });
      }
    } catch (e) {
      console.error("[stt] transcription failed:", e);
      setMicError(e.message.includes("API key") ? "ElevenLabs API key not configured — check Vercel env vars." : "Transcription failed. Please try again.");
    }
    setIsProcessing(false);
  }, []);

  const stop = useCallback(() => {
    wantListening.current = false;
    clearTimeout(silenceTimerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    setIsListening(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop(); // triggers onstop → transcribe
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setMicError(null);
    wantListening.current = true;
    silenceThresholdRef.current = silenceThresholdMs;
    recordingStartRef.current = Date.now();
    speechStartRef.current = null;
    lastSpeechRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Silence detection via AudioContext analyser
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart = null;

      const checkSilence = () => {
        if (!wantListening.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        if (avg < 20) {
          if (!silenceStart) silenceStart = Date.now();
          if (Date.now() - silenceStart >= silenceThresholdRef.current) {
            onSilenceRef.current?.();
            stop();
            return;
          }
        } else {
          if (!speechStartRef.current) speechStartRef.current = Date.now();
          lastSpeechRef.current = Date.now();
          silenceStart = null;
        }
        animFrameRef.current = requestAnimationFrame(checkSilence);
      };

      // Pick best supported format
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        audioCtx.close();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribe(blob);
      };

      mediaRecorder.start(100); // collect chunks every 100ms
      setIsListening(true);
      animFrameRef.current = requestAnimationFrame(checkSilence);
    } catch (e) {
      wantListening.current = false;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setMicError("Microphone access denied. Check System Settings → Privacy → Microphone.");
      } else {
        setMicError("Could not access microphone: " + e.message);
      }
    }
  }, [silenceThresholdMs, stop, transcribe]);

  // Doubles the silence threshold for the in-flight recording only (resets to
  // the configured default on the next start()) — the concrete signal behind
  // the "I need more time" pacing control.
  const requestMoreTime = useCallback(() => {
    silenceThresholdRef.current = silenceThresholdRef.current * 2;
  }, []);

  return { start, stop, isListening, isProcessing, micError, analyserRef, requestMoreTime };
}
