import { useCallback, useEffect, useRef, useState } from 'react';
import { BRAND_CONFIG } from '../config/brand';
import { blobToBase64, playFeedbackTone } from '../utils/mediaUtils';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export type HandsFreeStatus = 'off' | 'armed' | 'capturing' | 'unsupported' | 'error';

export interface RecordedAudioPayload {
  audioBase64?: string;
  mimeType?: string;
  transcript: string;
  durationSec: number;
}

interface UseVoiceCaptureOptions {
  onWakeCaptureComplete: (transcript: string) => void;
}

export function useVoiceCapture({ onWakeCaptureComplete }: UseVoiceCaptureOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [frequencyBands, setFrequencyBands] = useState<number[]>(() => Array(12).fill(0));
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const [handsFreeStatus, setHandsFreeStatus] = useState<HandsFreeStatus>('off');
  const [handsFreeBuffer, setHandsFreeBuffer] = useState('');

  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>('audio/webm');
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const manualSpeechRef = useRef<SpeechRecognitionLike | null>(null);
  const manualTranscriptRef = useRef<string>('');

  const wakeSpeechRef = useRef<SpeechRecognitionLike | null>(null);
  const handsFreeEnabledRef = useRef(false);
  const wakePhaseRef = useRef<'armed' | 'capturing'>('armed');
  const wakeCapturedRef = useRef<string>('');
  const wakeSilenceTimerRef = useRef<number | null>(null);
  const onWakeCompleteRef = useRef(onWakeCaptureComplete);

  useEffect(() => {
    onWakeCompleteRef.current = onWakeCaptureComplete;
  }, [onWakeCaptureComplete]);

  const cleanupAudioMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
    setFrequencyBands(Array(12).fill(0));
  }, []);

  const stopHandsFreeInternal = useCallback(() => {
    handsFreeEnabledRef.current = false;
    setHandsFreeEnabled(false);
    setHandsFreeStatus('off');
    setHandsFreeBuffer('');
    wakePhaseRef.current = 'armed';
    wakeCapturedRef.current = '';
    if (wakeSilenceTimerRef.current !== null) {
      window.clearTimeout(wakeSilenceTimerRef.current);
      wakeSilenceTimerRef.current = null;
    }
    if (wakeSpeechRef.current) {
      try {
        wakeSpeechRef.current.onend = null;
        wakeSpeechRef.current.stop();
      } catch {
        // ignore
      }
      wakeSpeechRef.current = null;
    }
  }, []);

  const finalizeWakeCapture = useCallback(() => {
    if (wakeSilenceTimerRef.current !== null) {
      window.clearTimeout(wakeSilenceTimerRef.current);
      wakeSilenceTimerRef.current = null;
    }
    const text = wakeCapturedRef.current.trim();
    wakePhaseRef.current = 'armed';
    wakeCapturedRef.current = '';
    setHandsFreeBuffer('');
    if (handsFreeEnabledRef.current) {
      setHandsFreeStatus('armed');
    }
    if (text.length >= 2) {
      onWakeCompleteRef.current(text);
    }
  }, []);

  const startHandsFreeLoop = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setHandsFreeStatus('unsupported');
      setHandsFreeEnabled(false);
      handsFreeEnabledRef.current = false;
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;
    wakeSpeechRef.current = recognition;

    let sessionProcessedIdx = 0;
    let wakeResultOffset = -1;

    recognition.onresult = (event) => {
      if (!handsFreeEnabledRef.current) return;

      let combinedSinceOffset = '';
      for (let i = Math.max(0, sessionProcessedIdx); i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || '';
        const lower = transcript.toLowerCase().trim();

        if (wakePhaseRef.current === 'armed') {
          const matchedVariant = BRAND_CONFIG.wakePhraseVariants.find((v) => lower.includes(v));
          if (matchedVariant) {
            playFeedbackTone('wake');
            wakePhaseRef.current = 'capturing';
            setHandsFreeStatus('capturing');
            wakeResultOffset = i;

            const idx = lower.indexOf(matchedVariant);
            const trailing = transcript.slice(idx + matchedVariant.length).replace(/^[,:\s]+/, '').trim();
            wakeCapturedRef.current = trailing;
            setHandsFreeBuffer(trailing);

            if (wakeSilenceTimerRef.current !== null) {
              window.clearTimeout(wakeSilenceTimerRef.current);
            }
            wakeSilenceTimerRef.current = window.setTimeout(finalizeWakeCapture, trailing ? 2200 : 4500);
          } else if (event.results[i].isFinal) {
            sessionProcessedIdx = i + 1;
          }
        } else if (i >= wakeResultOffset) {
          if (i === wakeResultOffset) {
            const matchedVariant = BRAND_CONFIG.wakePhraseVariants.find((v) => lower.includes(v));
            if (matchedVariant) {
              const idx = lower.indexOf(matchedVariant);
              combinedSinceOffset += transcript.slice(idx + matchedVariant.length).replace(/^[,:\s]+/, '') + ' ';
            } else {
              combinedSinceOffset += transcript + ' ';
            }
          } else {
            combinedSinceOffset += transcript + ' ';
          }
        }
      }

      if (wakePhaseRef.current === 'capturing') {
        const clean = combinedSinceOffset.trim();
        if (clean) {
          wakeCapturedRef.current = clean;
          setHandsFreeBuffer(clean);
          if (wakeSilenceTimerRef.current !== null) {
            window.clearTimeout(wakeSilenceTimerRef.current);
          }
          wakeSilenceTimerRef.current = window.setTimeout(finalizeWakeCapture, 2100);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicError('Permiso de micrófono denegado. Actívalo en el navegador para usar manos libres.');
        setHandsFreeStatus('error');
        handsFreeEnabledRef.current = false;
        setHandsFreeEnabled(false);
      }
    };

    recognition.onend = () => {
      if (wakePhaseRef.current === 'capturing' && wakeCapturedRef.current.trim()) {
        finalizeWakeCapture();
      }
      if (handsFreeEnabledRef.current) {
        window.setTimeout(() => {
          if (handsFreeEnabledRef.current) {
            startHandsFreeLoop();
          }
        }, 250);
      }
    };

    try {
      recognition.start();
      setHandsFreeStatus(wakePhaseRef.current === 'capturing' ? 'capturing' : 'armed');
    } catch {
      // Ya iniciado o bloqueado
    }
  }, [finalizeWakeCapture]);

  const toggleHandsFree = useCallback(
    (nextEnabled?: boolean) => {
      const target = typeof nextEnabled === 'boolean' ? nextEnabled : !handsFreeEnabledRef.current;
      if (!target) {
        stopHandsFreeInternal();
        return;
      }

      setMicError(null);
      if (!getSpeechRecognitionCtor()) {
        setHandsFreeStatus('unsupported');
        setMicError(
          `Tu navegador no soporta escucha continua de "${BRAND_CONFIG.wakePhraseDisplay}". Usa Chrome/Edge o pulsa para grabar.`
        );
        return;
      }

      handsFreeEnabledRef.current = true;
      setHandsFreeEnabled(true);
      wakePhaseRef.current = 'armed';
      startHandsFreeLoop();
    },
    [startHandsFreeLoop, stopHandsFreeInternal]
  );

  const startRecording = useCallback(async () => {
    setMicError(null);
    if (handsFreeEnabledRef.current) {
      stopHandsFreeInternal();
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Este navegador no permite grabar audio desde el micrófono.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      manualTranscriptRef.current = '';
      setLiveTranscript('');

      // Medidor visual de nivel de voz
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let lastFrameAt = 0;
        const tick = (timestamp: number) => {
          if (timestamp - lastFrameAt >= 45) {
            lastFrameAt = timestamp;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length / 255;
            setAudioLevel(Math.min(1, avg * 2.4));

            // Extrae 12 bandas útiles de frecuencia vocal (bins 1..48)
            const bandSize = 4;
            const nextBands: number[] = [];
            for (let b = 0; b < 12; b++) {
              let bandSum = 0;
              const startBin = 1 + b * bandSize;
              for (let j = 0; j < bandSize; j++) {
                bandSum += dataArray[startBin + j] ?? 0;
              }
              const norm = Math.min(1, (bandSum / (bandSize * 255)) * 1.9);
              nextBands.push(Math.round(Math.pow(norm, 0.85) * 100) / 100);
            }
            setFrequencyBands(nextBands);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // Medidor opcional
      }

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const chosenMime = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);

      recorderMimeRef.current = recorder.mimeType || chosenMime || 'audio/webm';
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      // Transcripción en vivo paralela (si el navegador la soporta)
      const Ctor = getSpeechRecognitionCtor();
      if (Ctor) {
        try {
          const sr = new Ctor();
          sr.lang = 'es-ES';
          sr.continuous = true;
          sr.interimResults = true;
          sr.onresult = (event) => {
            let full = '';
            for (let i = 0; i < event.results.length; i++) {
              full += event.results[i][0]?.transcript || '';
              if (i < event.results.length - 1) full += ' ';
            }
            const clean = full.trim();
            manualTranscriptRef.current = clean;
            setLiveTranscript(clean);
          };
          sr.start();
          manualSpeechRef.current = sr;
        } catch {
          // SpeechRecognition es opcional porque enviamos el audio real a Gemini
        }
      }

      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch {
      setMicError('No pudimos acceder al micrófono. Revisa los permisos o escribe tu nota abajo.');
      setIsRecording(false);
    }
  }, [stopHandsFreeInternal]);

  const stopRecording = useCallback(async (): Promise<RecordedAudioPayload | null> => {
    if (!mediaRecorderRef.current) {
      setIsRecording(false);
      return null;
    }

    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (manualSpeechRef.current) {
      try {
        manualSpeechRef.current.stop();
      } catch {
        // ignore
      }
      manualSpeechRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));

    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(audioChunksRef.current, { type: recorderMimeRef.current }));
      };
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resolve(new Blob(audioChunksRef.current, { type: recorderMimeRef.current }));
      }
    });

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    cleanupAudioMeter();
    setIsRecording(false);

    const audioBase64 = audioBlob.size > 0 ? await blobToBase64(audioBlob) : undefined;
    return {
      audioBase64,
      mimeType: recorderMimeRef.current,
      transcript: manualTranscriptRef.current.trim(),
      durationSec,
    };
  }, [cleanupAudioMeter]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      cleanupAudioMeter();
      stopHandsFreeInternal();
    };
  }, [cleanupAudioMeter, stopHandsFreeInternal]);

  return {
    isRecording,
    elapsedSec,
    audioLevel,
    frequencyBands,
    liveTranscript,
    micError,
    speechSupported,
    handsFreeEnabled,
    handsFreeStatus,
    handsFreeBuffer,
    startRecording,
    stopRecording,
    toggleHandsFree,
    clearMicError: () => setMicError(null),
  };
}
