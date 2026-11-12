import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Loader2,
  Mic,
  Radio,
  Send,
  Square,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BRAND_CONFIG, formatCurrencyAmount } from '../../config/brand';
import type { HandsFreeStatus, RecordedAudioPayload } from '../../hooks/useVoiceCapture';
import { processBrainDumpAi, processQuickVoiceAi } from '../../services/ai/geminiClient';
import type {
  AiExtractionResponse,
  ExtractedTaskDraft,
  NotebookTask,
  SparkTransactionType,
  TaskSource,
} from '../../types/notebook';
import { SparkAmount } from '../common/SparkAmount';

type CaptureMode = 'quick' | 'brain_dump';

interface RecordViewProps {
  balance: number;
  geminiReady: boolean;
  isRecording: boolean;
  elapsedSec: number;
  audioLevel: number;
  frequencyBands?: number[];
  liveTranscript: string;
  micError: string | null;
  speechSupported: boolean;
  handsFreeEnabled: boolean;
  handsFreeStatus: HandsFreeStatus;
  handsFreeBuffer: string;
  lastWakeResult: AiExtractionResponse | null;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<RecordedAudioPayload | null>;
  onToggleHandsFree: (next?: boolean) => void;
  onClearMicError: () => void;
  onAddTasks: (drafts: ExtractedTaskDraft[], source: TaskSource) => Promise<NotebookTask[]>;
  onRunWithSparkCharge: <T>(
    cost: number,
    txType: SparkTransactionType,
    label: string,
    action: () => Promise<T>
  ) => Promise<T>;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  onNavigateTab: (index: number) => void;
  onChangeWakeTargetMode: (mode: CaptureMode) => void;
}

export function RecordView({
  balance,
  geminiReady,
  isRecording,
  elapsedSec,
  audioLevel,
  frequencyBands = [],
  liveTranscript,
  micError,
  speechSupported,
  handsFreeEnabled,
  handsFreeStatus,
  handsFreeBuffer,
  lastWakeResult,
  onStartRecording,
  onStopRecording,
  onToggleHandsFree,
  onClearMicError,
  onAddTasks,
  onRunWithSparkCharge,
  onNotify,
  onNavigateTab,
  onChangeWakeTargetMode,
}: RecordViewProps) {
  const [mode, setMode] = useState<CaptureMode>('quick');
  const [processing, setProcessing] = useState(false);
  const [manualText, setManualText] = useState('');
  const [latestResult, setLatestResult] = useState<AiExtractionResponse | null>(null);

  const activeCost =
    mode === 'quick' ? BRAND_CONFIG.costs.quickVoice : BRAND_CONFIG.costs.brainDump;
  const hasEnoughBalance = balance >= activeCost;

  const displayedResult = latestResult || lastWakeResult;

  const selectMode = (next: CaptureMode) => {
    setMode(next);
    onChangeWakeTargetMode(next);
  };

  const executeCapture = async (payload: {
    text?: string;
    audioBase64?: string;
    mimeType?: string;
  }) => {
    setProcessing(true);
    try {
      if (mode === 'quick') {
        const res = await processQuickVoiceAi({
          text: payload.text,
          audioBase64: payload.audioBase64,
          mimeType: payload.mimeType,
        });
        if (res.tasks.length > 0) {
          await onAddTasks(res.tasks, 'voice_quick');
          setLatestResult(res);
          onNotify(`Tarea guardada (${formatCurrencyAmount(BRAND_CONFIG.costs.quickVoice)}).`, 'success');
        } else {
          onNotify('No entendimos ninguna tarea clara en el audio.', 'warning');
        }
      } else {
        const res = await onRunWithSparkCharge(
          BRAND_CONFIG.costs.brainDump,
          'brain_dump',
          'Vaciado mental con Gemini',
          () =>
            processBrainDumpAi({
              transcript: payload.text,
              audioBase64: payload.audioBase64,
              mimeType: payload.mimeType,
            })
        );
        if (res.tasks.length > 0) {
          await onAddTasks(res.tasks, 'brain_dump');
          setLatestResult(res);
          onNotify(
            `Gemini separó ${res.tasks.length} tareas (-${formatCurrencyAmount(BRAND_CONFIG.costs.brainDump)}).`,
            'success'
          );
        } else {
          onNotify('No se encontraron tareas para separar.', 'warning');
        }
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Error al procesar el audio.',
        'error'
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleMicPress = async () => {
    onClearMicError();
    if (processing) return;

    if (!isRecording) {
      if (!hasEnoughBalance) {
        onNotify(
          `Necesitas ${formatCurrencyAmount(activeCost)} para el vaciado mental.`,
          'warning'
        );
        return;
      }
      await onStartRecording();
      return;
    }

    const recorded = await onStopRecording();
    if (!recorded) return;

    if (!recorded.transcript && !recorded.audioBase64) {
      onNotify('No se capturó audio suficiente. Intenta hablar de nuevo.', 'warning');
      return;
    }

    await executeCapture({
      text: recorded.transcript || undefined,
      audioBase64: recorded.audioBase64,
      mimeType: recorded.mimeType,
    });
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = manualText.trim();
    if (!clean || processing) return;
    if (!hasEnoughBalance) {
      onNotify(
        `Saldo insuficiente (${formatCurrencyAmount(balance)}). Necesitas ${formatCurrencyAmount(activeCost)}.`,
        'warning'
      );
      return;
    }
    await executeCapture({ text: clean });
    setManualText('');
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const ringScale = 1 + audioLevel * 0.42;
  const waveformBands = Array.from({ length: 12 }, (_, idx) => {
    const raw = frequencyBands[idx] ?? 0;
    // Simetría central ligera para que las barras respondan con presencia incluso en voz suave
    const centerBias = 1 - Math.abs(idx - 5.5) / 8.5;
    return Math.min(1, Math.max(0, raw * (0.75 + centerBias * 0.45)));
  });

  return (
    <div className="flex min-h-full flex-col space-y-6 px-5 pb-28 pt-4">
      {/* Selector de modo: Nota rápida (0 ⚡) vs Vaciado mental (20 ⚡) */}
      <div className="nb-card grid grid-cols-2 gap-1.5 rounded-2xl p-1.5">
        <button
          type="button"
          onClick={() => selectMode('quick')}
          className={`flex flex-col items-center rounded-xl px-3 py-2.5 text-center transition ${
            mode === 'quick'
              ? 'bg-[#F5F5F7] text-[#0D0D0F]'
              : 'text-[#8E8E93] hover:text-[#F5F5F7]'
          }`}
        >
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Mic className="h-3.5 w-3.5 stroke-[1.8]" aria-hidden="true" />
            Nota rápida
          </span>
          <span
            className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal ${
              mode === 'quick' ? 'text-[#52525B]' : 'text-[#8E8E93]'
            }`}
          >
            <SparkAmount value={BRAND_CONFIG.costs.quickVoice} iconClassName="h-3 w-3" />
            <span>· Gratis</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => selectMode('brain_dump')}
          className={`flex flex-col items-center rounded-xl px-3 py-2.5 text-center transition ${
            mode === 'brain_dump'
              ? 'bg-[#F5F5F7] text-[#0D0D0F]'
              : 'text-[#8E8E93] hover:text-[#F5F5F7]'
          }`}
        >
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Brain className="h-3.5 w-3.5 stroke-[1.8]" aria-hidden="true" />
            Vaciado mental
          </span>
          <span
            className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal ${
              mode === 'brain_dump' ? 'text-[#52525B]' : 'text-[#8E8E93]'
            }`}
          >
            <SparkAmount value={BRAND_CONFIG.costs.brainDump} iconClassName="h-3 w-3" />
            <span>· Separa tareas</span>
          </span>
        </button>
      </div>

      {/* Modo Manos Libres "Oye Notebook" */}
      <div
        className={`nb-card rounded-2xl p-4 transition-colors ${
          handsFreeStatus === 'capturing' ? 'bg-[#1C1C1F]' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition ${
                handsFreeStatus === 'capturing' || handsFreeEnabled
                  ? 'border-[#F5F5F7] bg-[#F5F5F7] text-[#0D0D0F]'
                  : 'border-[#242428] bg-[#1E1E22] text-[#8E8E93]'
              }`}
            >
              <Radio className={`h-4.5 w-4.5 stroke-[1.7] ${handsFreeEnabled ? 'animate-pulse' : ''}`} aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display text-sm font-medium text-[#F5F5F7]">Manos libres</p>
                <span className="rounded-full border border-[#242428] bg-[#1E1E22] px-2 py-0.5 text-[11px] font-normal text-[#8E8E93]">
                  &ldquo;{BRAND_CONFIG.wakePhraseDisplay}&rdquo;
                </span>
              </div>
              <p className="mt-0.5 text-xs font-normal text-[#8E8E93]">
                {handsFreeStatus === 'capturing'
                  ? 'Escuchando...'
                  : handsFreeEnabled
                    ? `Di "${BRAND_CONFIG.wakePhraseDisplay}" + tu tarea`
                    : speechSupported
                      ? 'Captura sin tocar el móvil'
                      : 'Disponible en Chrome o Edge'}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-label={`Activar manos libres ${BRAND_CONFIG.wakePhraseDisplay}`}
            aria-checked={handsFreeEnabled}
            onClick={() => onToggleHandsFree()}
            className={`relative h-7 w-12 shrink-0 rounded-full p-1 transition-colors ${
              handsFreeEnabled ? 'bg-[#F5F5F7]' : 'bg-[#242428]'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full transition-transform ${
                handsFreeEnabled ? 'translate-x-5 bg-[#0D0D0F]' : 'translate-x-0 bg-[#F5F5F7]'
              }`}
            />
          </button>
        </div>

        {handsFreeStatus === 'capturing' && (
          <div className="mt-3 rounded-xl border border-[#242428] bg-[#1E1E22] px-3 py-2 text-xs font-normal text-[#F5F5F7]">
            <span className="font-medium text-[#8E8E93]">Capturando: </span>
            {handsFreeBuffer || 'Esperando tu voz...'}
          </div>
        )}
      </div>

      {/* Botón circular central de micrófono (acento quirúrgico de marca) */}
      <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
        <div className="relative flex items-center justify-center">
          {/* Anillo exterior biselado tipo hardware */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-44 w-44 rounded-full border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent"
          />
          {!isRecording && !processing && (
            <span
              aria-hidden="true"
              className="animate-nb-breathe pointer-events-none absolute h-38 w-38 rounded-full border border-[var(--nb-accent)]/45"
            />
          )}
          {isRecording && (
            <>
              <span
                style={{ transform: `scale(${ringScale})` }}
                className="pointer-events-none absolute h-38 w-38 rounded-full border border-[var(--nb-accent)] opacity-50 transition-transform duration-100"
              />
              <span className="animate-nb-ring pointer-events-none absolute h-34 w-34 rounded-full border border-[var(--nb-accent)] opacity-70" />
            </>
          )}

          <button
            type="button"
            onClick={handleMicPress}
            disabled={processing}
            aria-label={
              processing
                ? 'Analizando nota de voz'
                : isRecording
                  ? `Detener grabación (${formatTimer(elapsedSec)})`
                  : 'Pulsa y habla'
            }
            className={`relative flex h-32 w-32 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-[0.94] ${
              processing
                ? 'border border-[#242428] bg-[#161618] text-[#F5F5F7]'
                : 'bg-gradient-to-b from-[#FF4659] to-[var(--nb-accent)] text-[var(--nb-accent-fg)] shadow-[0_14px_32px_-8px_rgba(255,46,67,0.48),inset_0_1px_0_rgba(255,255,255,0.28)] hover:brightness-105'
            }`}
          >
            {processing ? (
              <Loader2 className="h-9 w-9 stroke-[1.8] animate-spin" aria-hidden="true" />
            ) : isRecording ? (
              <Square className="h-8 w-8 fill-current" aria-hidden="true" />
            ) : (
              <Mic className="h-10 w-10 stroke-[1.7]" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Visualizador de espectro de audio en tiempo real */}
        <div
          aria-hidden="true"
          className="mt-5 flex h-7 items-center justify-center gap-1.5"
        >
          {waveformBands.map((band, idx) => {
            const heightPx = isRecording ? Math.round(5 + band * 21) : 4;
            const activeOpacity = isRecording ? Math.max(0.35, 0.35 + band * 0.65) : 0.45;
            return (
              <span
                key={idx}
                style={{
                  height: `${heightPx}px`,
                  opacity: activeOpacity,
                }}
                className={`w-1 rounded-full transition-[height,opacity,background-color] duration-75 motion-reduce:transition-none ${
                  isRecording ? 'bg-[#F5F5F7]' : 'bg-[#2E2E34]'
                }`}
              />
            );
          })}
        </div>

        <p className="font-display font-mono-tabular mt-2.5 text-sm font-medium tracking-tight text-[#F5F5F7]">
          {processing
            ? 'Analizando...'
            : isRecording
              ? formatTimer(elapsedSec)
              : 'Pulsa y habla'}
        </p>

        <p className="mt-1.5 max-w-xs text-xs font-normal leading-relaxed text-[#8E8E93]">
          {isRecording
            ? liveTranscript || 'Escuchando... pulsa de nuevo para terminar.'
            : mode === 'quick'
              ? 'Una sola tarea rápida, por ejemplo: "Examen de Historia el viernes".'
              : 'Suelta varias tareas seguidas y las ordenamos por separado.'}
        </p>

        {!hasEnoughBalance && (
          <button
            type="button"
            onClick={() => onNavigateTab(4)}
            className="nb-card mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-[#F5F5F7] transition hover:bg-[#1C1C1F]"
          >
            <span>Recargar para Vaciado mental · Ir a Cartera</span>
          </button>
        )}

        {micError && (
          <p className="nb-card mt-3 max-w-xs rounded-xl px-3.5 py-2 text-xs font-normal text-[#F5F5F7]">
            {micError}
          </p>
        )}
      </div>

      {/* Entrada alternativa de texto/dictado */}
      <form onSubmit={handleManualSubmit} className="nb-card rounded-2xl p-4">
        <div className="mb-2.5 flex items-center justify-between text-[11px] font-normal text-[#8E8E93]">
          <span>Dictado por texto</span>
          <span>{geminiReady ? 'IA activa' : 'Modo local'}</span>
        </div>
        <div className="flex items-end gap-2.5">
          <textarea
            rows={2}
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder={
              mode === 'quick'
                ? 'Ej: Examen de historia el viernes a las 10...'
                : 'Ej: Práctica de física el lunes, comprar café hoy y cita dental mañana...'
            }
            className="min-w-0 flex-1 resize-none rounded-xl border border-[#242428] bg-[#1E1E22] px-3.5 py-2.5 text-xs font-normal text-[#F5F5F7] placeholder:text-[#8E8E93] focus:border-[#2E2E34] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!manualText.trim() || processing}
            aria-label="Procesar texto"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5F5F7] text-[#0D0D0F] transition hover:bg-white disabled:opacity-35"
          >
            <Send className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
          </button>
        </div>
      </form>

      {/* Resultado extraído */}
      {displayedResult && (
        <div className="nb-card space-y-3 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[#F5F5F7]">
              <CheckCircle2 className="h-4 w-4 shrink-0 stroke-[1.7] text-[#F5F5F7]" aria-hidden="true" />
              <span>{displayedResult.summary}</span>
            </div>
            <span className="rounded-full border border-[#242428] bg-[#1E1E22] px-2.5 py-0.5 text-[11px] font-normal text-[#8E8E93]">
              {displayedResult.mode === 'gemini' ? 'IA' : 'Local'}
            </span>
          </div>

          <div className="space-y-2.5">
            {displayedResult.tasks.map((item, idx) => {
              const titleMentionsExam = /\b(examen|parcial|control|final)\b/i.test(item.title);
              const metaParts = [
                item.category,
                item.dueDate ? `${item.dueDate}${item.dueTime ? ` · ${item.dueTime}` : ''}` : null,
                item.isExam && !titleMentionsExam ? 'Examen' : null,
              ].filter(Boolean);

              return (
                <div
                  key={`${item.title}-${idx}`}
                  className="rounded-xl border border-[#242428] bg-[#1E1E22] px-3.5 py-2.5"
                >
                  <p className="truncate text-xs font-medium text-[#F5F5F7]">{item.title}</p>
                  <p className="font-mono-tabular mt-1 text-[11px] font-normal text-[#8E8E93]">
                    {metaParts.join(' · ')}
                  </p>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab(1)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#242428] bg-[#1E1E22] py-2.5 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
          >
            Ver en Tareas
            <ArrowRight className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
