import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { BottomNav } from './components/layout/BottomNav';
import { TopHeader } from './components/layout/TopHeader';
import { SettingsAuthModal } from './components/modals/SettingsAuthModal';
import { TaskEditModal } from './components/modals/TaskEditModal';
import { HomeView } from './components/views/HomeView';
import { RecordView } from './components/views/RecordView';
import { ScannerView } from './components/views/ScannerView';
import { TasksView } from './components/views/TasksView';
import { WalletView } from './components/views/WalletView';
import { BRAND_CONFIG, formatCurrencyAmount } from './config/brand';
import { useNotebookStore } from './hooks/useNotebookStore';
import { useVoiceCapture } from './hooks/useVoiceCapture';
import {
  fetchAiStatus,
  getSessionGeminiKey,
  processBrainDumpAi,
  processQuickVoiceAi,
} from './services/ai/geminiClient';
import type { AiExtractionResponse, ExtractedTaskDraft, NotebookTask } from './types/notebook';
import { playFeedbackTone } from './utils/mediaUtils';
import {
  findDueReminders,
  formatReminderMessage,
  loadRemindersEnabled,
  loadSentReminderIds,
  markReminderSent,
  saveRemindersEnabled,
} from './utils/reminderUtils';

export function App() {
  const {
    user,
    isFirebaseConfigured,
    tasks,
    wallet,
    loading,
    toast,
    showToast,
    dismissToast,
    addTasks,
    toggleTask,
    updateTask,
    deleteTask,
    clearCompletedTasks,
    runWithSparkCharge,
    claimDailyBonus,
    purchasePack,
    creditReferralBonus,
  } = useNotebookStore();

  const [activeIndex, setActiveIndex] = useState(0);
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [editingTask, setEditingTask] = useState<NotebookTask | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverGeminiReady, setServerGeminiReady] = useState(false);
  const [sessionKeyExists, setSessionKeyExists] = useState(() => Boolean(getSessionGeminiKey()));
  const [wakeTargetMode, setWakeTargetMode] = useState<'quick' | 'brain_dump'>('quick');
  const [lastWakeResult, setLastWakeResult] = useState<AiExtractionResponse | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(() => loadRemindersEnabled());

  const pagerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startScrollLeft: number;
    pointerId: number;
  } | null>(null);

  const refreshAiStatus = useCallback(async () => {
    const status = await fetchAiStatus();
    setServerGeminiReady(status.geminiConfigured);
    setSessionKeyExists(Boolean(getSessionGeminiKey()));
  }, []);

  useEffect(() => {
    void refreshAiStatus();
  }, [refreshAiStatus]);

  const handleToggleReminders = useCallback(async () => {
    if (remindersEnabled) {
      setRemindersEnabled(false);
      saveRemindersEnabled(false);
      showToast('Recordatorios desactivados.', 'info');
      return;
    }

    let browserGranted = false;
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        browserGranted = true;
      } else if (Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          browserGranted = perm === 'granted';
        } catch {
          browserGranted = false;
        }
      }
    }

    setRemindersEnabled(true);
    saveRemindersEnabled(true);
    showToast(
      browserGranted
        ? 'Recordatorios activados (avisos del navegador e in-app).'
        : 'Recordatorios activados dentro de la app.',
      'success'
    );
  }, [remindersEnabled, showToast]);

  const handleImportBackupTasks = useCallback(
    async (drafts: ExtractedTaskDraft[]) => {
      const created = await addTasks(drafts, 'manual');
      return created.length;
    },
    [addTasks]
  );

  useEffect(() => {
    if (!remindersEnabled || loading) return;

    const checkDueReminders = () => {
      const sent = loadSentReminderIds();
      const due = findDueReminders(tasks, Date.now(), sent);
      if (due.length === 0) return;

      for (const item of due) {
        markReminderSent(item.key);
        const body = formatReminderMessage(item);
        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification(BRAND_CONFIG.appName, { body, icon: '/icon.svg' });
          } catch {
            // Algunos navegadores móviles requieren ServiceWorkerRegistration para Notification
          }
        }
      }

      showToast(formatReminderMessage(due[0]), 'info');
      playFeedbackTone('wake');
    };

    checkDueReminders();
    const timer = window.setInterval(checkDueReminders, 30_000);
    return () => window.clearInterval(timer);
  }, [loading, remindersEnabled, showToast, tasks]);

  const handleWakeCaptureComplete = useCallback(
    async (transcript: string) => {
      try {
        if (wakeTargetMode === 'quick') {
          const res = await processQuickVoiceAi({ text: transcript });
          if (res.tasks.length > 0) {
            await addTasks(res.tasks, 'voice_quick');
            setLastWakeResult(res);
            showToast(
              `"${BRAND_CONFIG.wakePhraseDisplay}": tarea guardada (${formatCurrencyAmount(BRAND_CONFIG.costs.quickVoice)}).`,
              'success'
            );
          }
        } else {
          const res = await runWithSparkCharge(
            BRAND_CONFIG.costs.brainDump,
            'brain_dump',
            `Manos libres (${BRAND_CONFIG.wakePhraseDisplay})`,
            () => processBrainDumpAi({ transcript })
          );
          if (res.tasks.length > 0) {
            await addTasks(res.tasks, 'brain_dump');
            setLastWakeResult(res);
            showToast(
              `"${BRAND_CONFIG.wakePhraseDisplay}": ${res.tasks.length} tareas añadidas (-${formatCurrencyAmount(BRAND_CONFIG.costs.brainDump)}).`,
              'success'
            );
          }
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Error procesando comando manos libres.',
          'error'
        );
      }
    },
    [addTasks, runWithSparkCharge, showToast, wakeTargetMode]
  );

  const voice = useVoiceCapture({
    onWakeCaptureComplete: handleWakeCaptureComplete,
  });

  const navigateToTab = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(4, index));
    setActiveIndex(clamped);
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: 'smooth',
    });
  }, []);

  const handlePagerScroll = useCallback(() => {
    const el = pagerRef.current;
    if (!el || el.clientWidth <= 0) return;
    const ratio = el.scrollLeft / el.clientWidth;
    setSwipeProgress(Math.max(0, Math.min(4, ratio)));
    const nearest = Math.round(ratio);
    if (nearest !== activeIndex && nearest >= 0 && nearest <= 4) {
      setActiveIndex(nearest);
    }
  }, [activeIndex]);

  // Permite deslizar también con ratón en escritorio sin interferir con inputs/botones
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, label')) return;
    const el = pagerRef.current;
    if (!el) return;
    dragStateRef.current = {
      active: false,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: el.scrollLeft,
      pointerId: e.pointerId,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const el = pagerRef.current;
    if (!drag || !el) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.active) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        drag.active = true;
        el.style.scrollSnapType = 'none';
      } else if (Math.abs(dy) > 12) {
        dragStateRef.current = null;
        return;
      }
    }

    if (drag.active) {
      el.scrollLeft = drag.startScrollLeft - dx;
    }
  };

  const handlePointerEnd = () => {
    const drag = dragStateRef.current;
    const el = pagerRef.current;
    if (!drag || !el) return;
    dragStateRef.current = null;
    if (drag.active) {
      el.style.scrollSnapType = 'x mandatory';
      const targetIndex = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      navigateToTab(targetIndex);
    }
  };

  useEffect(() => {
    const onResize = () => {
      const el = pagerRef.current;
      if (!el) return;
      el.scrollTo({ left: activeIndex * el.clientWidth, behavior: 'auto' });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeIndex]);

  const pendingCount = tasks.filter((t) => !t.completed).length;
  const geminiReady = serverGeminiReady || sessionKeyExists;

  const ToastIcon =
    toast?.tone === 'success'
      ? CheckCircle2
      : toast?.tone === 'warning'
        ? AlertTriangle
        : toast?.tone === 'error'
          ? XCircle
          : Info;

  return (
    <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#0D0D0F] sm:p-4">
      {/* Marco Mobile-First industrial de lujo */}
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0D0D0F] sm:h-[min(92dvh,880px)] sm:max-w-[430px] sm:rounded-[34px] sm:border sm:border-white/[0.09] sm:shadow-[0_28px_70px_-15px_rgba(0,0,0,0.85)]">
        {/* Luz ambiental difusa superior muy sutil para profundidad */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-56"
          style={{
            background:
              'radial-gradient(ellipse 85% 65% at 50% -15%, rgba(255, 255, 255, 0.055), rgba(255, 46, 67, 0.03) 48%, transparent 78%)',
          }}
        />

        <TopHeader
          balance={wallet.balance}
          user={user}
          firebaseReady={isFirebaseConfigured}
          geminiReady={geminiReady}
          onOpenWallet={() => navigateToTab(4)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Toast flotante */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-4 top-20 z-40 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-[#242428] bg-[#161618] px-4 py-2.5 text-xs font-normal text-[#F5F5F7]">
              <ToastIcon
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 stroke-[1.7] ${
                  toast.tone === 'error' ? 'text-[#F5F5F7]' : 'text-[#8E8E93]'
                }`}
              />
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    dismissToast();
                  }}
                  className="ml-1 rounded-full border border-[#242428] bg-[#1E1E22] px-2.5 py-1 text-[11px] font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Carrusel deslizable horizontal de 5 pantallas */}
        <main
          ref={pagerRef}
          onScroll={handlePagerScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          className="no-scrollbar relative flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth"
        >
          {loading ? (
            <div className="flex h-full w-full shrink-0 items-center justify-center text-xs text-[#8E8E93]">
              Cargando {BRAND_CONFIG.appName}...
            </div>
          ) : (
            <>
              <div
                style={{ opacity: Math.max(0.5, 1 - Math.abs(swipeProgress - 0) * 0.45) }}
                className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto overscroll-y-contain transition-opacity duration-150"
              >
                <HomeView
                  tasks={tasks}
                  onToggleTask={toggleTask}
                  onEditTask={setEditingTask}
                  onDeleteTask={deleteTask}
                  onNavigateTab={navigateToTab}
                />
              </div>

              <div
                style={{ opacity: Math.max(0.5, 1 - Math.abs(swipeProgress - 1) * 0.45) }}
                className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto overscroll-y-contain transition-opacity duration-150"
              >
                <TasksView
                  tasks={tasks}
                  onToggleTask={toggleTask}
                  onEditTask={setEditingTask}
                  onDeleteTask={deleteTask}
                  onAddTasks={addTasks}
                  onClearCompleted={clearCompletedTasks}
                  onNotify={showToast}
                />
              </div>

              <div
                style={{ opacity: Math.max(0.5, 1 - Math.abs(swipeProgress - 2) * 0.45) }}
                className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto overscroll-y-contain transition-opacity duration-150"
              >
                <RecordView
                  balance={wallet.balance}
                  geminiReady={geminiReady}
                  isRecording={voice.isRecording}
                  elapsedSec={voice.elapsedSec}
                  audioLevel={voice.audioLevel}
                  frequencyBands={voice.frequencyBands}
                  liveTranscript={voice.liveTranscript}
                  micError={voice.micError}
                  speechSupported={voice.speechSupported}
                  handsFreeEnabled={voice.handsFreeEnabled}
                  handsFreeStatus={voice.handsFreeStatus}
                  handsFreeBuffer={voice.handsFreeBuffer}
                  lastWakeResult={lastWakeResult}
                  onStartRecording={voice.startRecording}
                  onStopRecording={voice.stopRecording}
                  onToggleHandsFree={voice.toggleHandsFree}
                  onClearMicError={voice.clearMicError}
                  onAddTasks={addTasks}
                  onRunWithSparkCharge={runWithSparkCharge}
                  onNotify={showToast}
                  onNavigateTab={navigateToTab}
                  onChangeWakeTargetMode={setWakeTargetMode}
                />
              </div>

              <div
                style={{ opacity: Math.max(0.5, 1 - Math.abs(swipeProgress - 3) * 0.45) }}
                className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto overscroll-y-contain transition-opacity duration-150"
              >
                <ScannerView
                  balance={wallet.balance}
                  geminiReady={geminiReady}
                  onAddTasks={addTasks}
                  onRunWithSparkCharge={runWithSparkCharge}
                  onNotify={showToast}
                  onNavigateTab={navigateToTab}
                />
              </div>

              <div
                style={{ opacity: Math.max(0.5, 1 - Math.abs(swipeProgress - 4) * 0.45) }}
                className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto overscroll-y-contain transition-opacity duration-150"
              >
                <WalletView
                  user={user}
                  wallet={wallet}
                  onClaimDaily={claimDailyBonus}
                  onPurchasePack={purchasePack}
                  onCreditReferralDemo={creditReferralBonus}
                  onNotify={showToast}
                />
              </div>
            </>
          )}
        </main>

        <BottomNav
          activeIndex={activeIndex}
          swipeProgress={swipeProgress}
          pendingCount={pendingCount}
          isRecording={voice.isRecording}
          handsFreeArmed={voice.handsFreeEnabled}
          onSelectTab={navigateToTab}
        />
      </div>

      <TaskEditModal
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={updateTask}
      />

      <SettingsAuthModal
        open={settingsOpen}
        user={user}
        tasks={tasks}
        firebaseReady={isFirebaseConfigured}
        serverGeminiReady={serverGeminiReady}
        remindersEnabled={remindersEnabled}
        onToggleReminders={handleToggleReminders}
        onImportTasks={handleImportBackupTasks}
        onClose={() => setSettingsOpen(false)}
        onGeminiKeyUpdated={() => void refreshAiStatus()}
        onNotify={showToast}
      />
    </div>
  );
}

export default App;
