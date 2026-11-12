import {
  ArrowRight,
  Camera,
  CheckCircle2,
  FileImage,
  Loader2,
  ScanLine,
  Upload,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { BRAND_CONFIG, formatCurrencyAmount } from '../../config/brand';
import { scanWhiteboardImageAi } from '../../services/ai/geminiClient';
import type {
  AiExtractionResponse,
  ExtractedTaskDraft,
  NotebookTask,
  SparkTransactionType,
  TaskSource,
} from '../../types/notebook';
import { compressImageToJpeg, generateSampleWhiteboardImage } from '../../utils/mediaUtils';
import { SparkAmount } from '../common/SparkAmount';

interface ScannerViewProps {
  balance: number;
  geminiReady: boolean;
  onAddTasks: (drafts: ExtractedTaskDraft[], source: TaskSource) => Promise<NotebookTask[]>;
  onRunWithSparkCharge: <T>(
    cost: number,
    txType: SparkTransactionType,
    label: string,
    action: () => Promise<T>
  ) => Promise<T>;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  onNavigateTab: (index: number) => void;
}

export function ScannerView({
  balance,
  geminiReady,
  onAddTasks,
  onRunWithSparkCharge,
  onNotify,
  onNavigateTab,
}: ScannerViewProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{
    base64: string;
    mimeType: string;
    isSampleWhiteboard: boolean;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<AiExtractionResponse | null>(null);

  const cost = BRAND_CONFIG.costs.scanner;
  const canAfford = balance >= cost;

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      setResult(null);
      const compressed = await compressImageToJpeg(file);
      setPreviewUrl(compressed.previewDataUrl);
      setPendingPayload({
        base64: compressed.base64,
        mimeType: compressed.mimeType,
        isSampleWhiteboard: false,
      });
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'No pudimos cargar esa foto.',
        'error'
      );
    }
  };

  const handleLoadSampleWhiteboard = () => {
    setResult(null);
    const sample = generateSampleWhiteboardImage();
    setPreviewUrl(sample.previewDataUrl);
    setPendingPayload({
      base64: sample.base64,
      mimeType: sample.mimeType,
      isSampleWhiteboard: true,
    });
  };

  const handleAnalyze = async () => {
    if (!pendingPayload || scanning) return;
    if (!canAfford) {
      onNotify(
        `Necesitas ${formatCurrencyAmount(cost)} para escanear apuntes.`,
        'warning'
      );
      return;
    }

    setScanning(true);
    try {
      const response = await onRunWithSparkCharge(
        cost,
        'scanner',
        'Escáner de pizarra / apuntes',
        () =>
          scanWhiteboardImageAi({
            imageBase64: pendingPayload.base64,
            mimeType: pendingPayload.mimeType,
            isSampleWhiteboard: pendingPayload.isSampleWhiteboard,
          })
      );

      setResult(response);
      if (response.tasks.length > 0) {
        await onAddTasks(response.tasks, 'scanner');
        onNotify(
          `Extraídos ${response.tasks.length} elementos (-${formatCurrencyAmount(cost)}).`,
          'success'
        );
      } else {
        onNotify('No se detectaron fechas ni entregas en la foto.', 'warning');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Error analizando la imagen.',
        'error'
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-6 px-5 pb-28 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-medium leading-tight tracking-[-0.025em] text-[#F5F5F7]">
            Escáner
          </h1>
          <p className="mt-1 text-[13px] font-normal text-[#8E8E93]">
            Fotografía la pizarra o apuntes para extraer entregas y exámenes.
          </p>
        </div>

        <span className="inline-flex shrink-0 items-center rounded-full border border-[#242428] bg-[#161618] px-3 py-1.5 text-xs font-medium text-[#F5F5F7]">
          <SparkAmount value={cost} iconClassName="h-3.5 w-3.5" />
        </span>
      </div>

      {/* Inputs ocultos para cámara y galería */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Área visual de captura / vista previa */}
      <div className="nb-card relative overflow-hidden rounded-2xl p-4">
        {previewUrl ? (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-xl border border-[#242428] bg-[#0D0D0F]">
              <img
                src={previewUrl}
                alt="Vista previa de pizarra o apuntes"
                className="max-h-64 w-full object-contain"
              />
              {scanning && (
                <div className="pointer-events-none absolute inset-0 bg-[#0D0D0F]/45 backdrop-blur-[1px]">
                  <div className="animate-nb-scan absolute inset-x-0 h-0.5 bg-[#F5F5F7]" />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning}
                className="flex-1 rounded-xl border border-[#242428] bg-[#1E1E22] py-2.5 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529] disabled:opacity-45"
              >
                Cambiar foto
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={scanning || !canAfford}
                className="inline-flex flex-[1.5] items-center justify-center gap-2 rounded-xl bg-[#F5F5F7] py-2.5 text-xs font-medium text-[#0D0D0F] transition hover:bg-white disabled:opacity-45"
              >
                {scanning ? (
                  <>
                    <Loader2 className="h-4 w-4 stroke-[1.8] animate-spin" aria-hidden="true" />
                    Extrayendo fechas...
                  </>
                ) : (
                  <>
                    <ScanLine className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
                    <span>Escanear</span>
                    <SparkAmount value={cost} iconClassName="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center px-3 py-7 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]">
              <FileImage className="h-6 w-6 stroke-[1.6]" aria-hidden="true" />
            </div>
            <h2 className="font-display text-base font-medium text-[#F5F5F7]">
              Sube o haz una foto a tu pizarra
            </h2>
            <p className="mt-1.5 max-w-xs text-xs font-normal leading-relaxed text-[#8E8E93]">
              Detecta exámenes, parciales, aulas y fechas de entrega automáticamente.
            </p>

            <div className="mt-6 grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#F5F5F7] px-4 py-3 text-xs font-medium text-[#0D0D0F] transition hover:bg-white active:scale-97"
              >
                <Camera className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
                Hacer foto
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#242428] bg-[#1E1E22] px-4 py-3 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529] active:scale-97"
              >
                <Upload className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
                Subir foto
              </button>
            </div>

            <button
              type="button"
              onClick={handleLoadSampleWhiteboard}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#242428] bg-[#1E1E22] px-4 py-2 text-xs font-normal text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
            >
              Probar con pizarra de ejemplo
            </button>
          </div>
        )}
      </div>

      {!canAfford && (
        <button
          type="button"
          onClick={() => onNavigateTab(4)}
          className="nb-card flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-xs font-normal text-[#F5F5F7] transition hover:bg-[#1C1C1F]"
        >
          <span className="inline-flex flex-wrap items-center gap-1">
            <span>Saldo insuficiente (</span>
            <SparkAmount value={balance} iconClassName="h-3 w-3" />
            <span>). Necesitas</span>
            <SparkAmount value={cost} iconClassName="h-3 w-3" />
            <span>para escanear.</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
        </button>
      )}

      {!geminiReady && (
        <div className="nb-card rounded-2xl px-4 py-3.5 text-xs font-normal leading-relaxed text-[#8E8E93]">
          <span className="font-medium text-[#F5F5F7]">Nota de entorno: </span>
          Para analizar fotos reales de tu cámara añade <code className="text-[#F5F5F7]">GEMINI_API_KEY</code> en{' '}
          <code className="text-[#F5F5F7]">.env</code> (o en Ajustes). La pizarra de ejemplo funciona sin clave.
        </div>
      )}

      {/* Resultados extraídos */}
      {result && (
        <div className="nb-card space-y-3 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[#F5F5F7]">
              <CheckCircle2 className="h-4 w-4 shrink-0 stroke-[1.7] text-[#F5F5F7]" aria-hidden="true" />
              <span>{result.summary}</span>
            </div>
            <span className="rounded-full border border-[#242428] bg-[#1E1E22] px-2.5 py-0.5 text-[11px] font-normal text-[#8E8E93]">
              {result.mode === 'gemini' ? 'IA' : 'Local'}
            </span>
          </div>

          <div className="space-y-2.5">
            {result.tasks.map((item, idx) => {
              const titleMentionsExam = /\b(examen|parcial|control|final)\b/i.test(item.title);
              const metaParts = [
                item.dueDate
                  ? `${item.dueDate}${item.dueTime ? ` · ${item.dueTime}` : ''}`
                  : 'Sin fecha',
                item.isExam && !titleMentionsExam ? 'Examen' : null,
              ].filter(Boolean);

              return (
                <div
                  key={`${item.title}-${idx}`}
                  className="rounded-xl border border-[#242428] bg-[#1E1E22] p-3.5"
                >
                  <p className="text-sm font-medium text-[#F5F5F7]">{item.title}</p>
                  {item.notes && <p className="mt-1 text-xs font-normal text-[#8E8E93]">{item.notes}</p>}
                  <p className="font-mono-tabular mt-1.5 text-[11px] font-normal text-[#8E8E93]">
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
            Ver todas en Tareas
            <ArrowRight className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
