import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_CONFIG, formatCurrencyAmount } from '../config/brand';
import { getFirebaseIdToken, observeAuthProfile } from '../services/firebase/authService';
import { isFirebaseConfigured } from '../services/firebase/config';
import {
  redeemReferralOnServer,
  verifyStripeCheckoutSession,
} from '../services/payments/paymentClient';
import {
  createRepositoryForUser,
  type NotebookSnapshot,
} from '../services/repository/notebookRepository';
import type {
  AppUserProfile,
  ExtractedTaskDraft,
  NotebookTask,
  SparkTransactionType,
  TaskSource,
} from '../types/notebook';
import { playFeedbackTone } from '../utils/mediaUtils';
import { canRedeemPendingReferral, normalizeReferralCode } from '../utils/referralUtils';

export interface ToastNotice {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const PENDING_REF_KEY = 'reca_pending_ref';
const REDEEMED_REF_PREFIX = 'reca_redeemed_ref_v1_';
const PENDING_CHECKOUT_KEY = 'reca_pending_checkout_session';
const PROCESSED_CHECKOUT_PREFIX = 'reca_processed_checkout_v1_';

export function useNotebookStore() {
  const [user, setUser] = useState<AppUserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [snapshot, setSnapshot] = useState<NotebookSnapshot>({
    tasks: [],
    wallet: {
      balance: BRAND_CONFIG.currency.initialBalance,
      lastDailyClaimAt: null,
      referralCode: 'RC-100',
      referralCount: 0,
      transactions: [],
    },
    loading: true,
  });
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const tasksRef = useRef<NotebookTask[]>([]);
  const redeemingRef = useRef(false);
  const verifyingCheckoutRef = useRef(false);
  tasksRef.current = snapshot.tasks;

  const showToast = useCallback(
    (
      message: string,
      tone: ToastNotice['tone'] = 'info',
      action?: ToastNotice['action']
    ) => {
      setToast({ id: Date.now(), tone, message, action });
    },
    []
  );

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      let dirty = false;

      const rawRef = normalizeReferralCode(url.searchParams.get('ref'));
      if (rawRef) {
        localStorage.setItem(PENDING_REF_KEY, rawRef);
        url.searchParams.delete('ref');
        dirty = true;
      }

      const checkoutState = url.searchParams.get('checkout');
      const sessionId = url.searchParams.get('session_id')?.trim();
      if (checkoutState === 'success' && sessionId) {
        localStorage.setItem(PENDING_CHECKOUT_KEY, sessionId);
        url.searchParams.delete('checkout');
        url.searchParams.delete('session_id');
        dirty = true;
      } else if (checkoutState === 'cancelled') {
        url.searchParams.delete('checkout');
        dirty = true;
        showToast('Pago cancelado. No se realizó ningún cargo.', 'info');
      }

      if (dirty) {
        const cleaned = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', cleaned || '/');
      }
    } catch {
      // Ignorar URL inválida
    }
  }, [showToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const unsub = observeAuthProfile((profile) => {
      setUser(profile);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  const repository = useMemo(() => {
    if (user) {
      return createRepositoryForUser(user.uid, user.provider);
    }
    return createRepositoryForUser('local-student', 'local');
  }, [user]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = repository.subscribe((next) => {
      setSnapshot(next);
    });
    return unsub;
  }, [authReady, repository]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!authReady || snapshot.loading || redeemingRef.current) return;
    if (isFirebaseConfigured && !user) return;

    const uidKey = user?.uid || 'local-student';
    const redeemedKey = `${REDEEMED_REF_PREFIX}${uidKey}`;
    const pendingCode = localStorage.getItem(PENDING_REF_KEY);
    if (!pendingCode) return;

    const decision = canRedeemPendingReferral({
      pendingCode,
      ownReferralCode: snapshot.wallet.referralCode,
      alreadyRedeemedCode: localStorage.getItem(redeemedKey),
    });

    if (!decision.eligible || !decision.code) {
      localStorage.removeItem(PENDING_REF_KEY);
      if (decision.reason === 'self' && decision.code) {
        showToast(`No puedes canjear tu propio código ${decision.code}.`, 'warning');
      }
      return;
    }

    const code = decision.code;
    redeemingRef.current = true;
    localStorage.setItem(redeemedKey, code);
    localStorage.removeItem(PENDING_REF_KEY);

    const creditReferral = async () => {
      if (user?.provider === 'firebase') {
        const idToken = await getFirebaseIdToken();
        if (idToken) {
          const serverRes = await redeemReferralOnServer({ referralCode: code, idToken });
          if (serverRes.mode === 'server') {
            if (serverRes.inviteeCredited) {
              playFeedbackTone('spark');
              const extra = serverRes.inviterCredited ? ' ¡Tu amigo también recibió su bono!' : '';
              showToast(
                `¡Invitación ${code} canjeada! +${formatCurrencyAmount(serverRes.amount || BRAND_CONFIG.currency.referralBonus)}.${extra}`,
                'success'
              );
            }
            return;
          }
        }
      }

      const gained = await repository.creditReferralBonus(`Invitación canjeada (${code})`);
      playFeedbackTone('spark');
      showToast(`¡Invitación ${code} canjeada! +${formatCurrencyAmount(gained)}.`, 'success');
    };

    void creditReferral()
      .catch((err) => {
        localStorage.removeItem(redeemedKey);
        if (err instanceof Error && /no existe|propio código/i.test(err.message)) {
          showToast(err.message, 'warning');
          return;
        }
        localStorage.setItem(PENDING_REF_KEY, code);
      })
      .finally(() => {
        redeemingRef.current = false;
      });
  }, [authReady, repository, showToast, snapshot.loading, snapshot.wallet.referralCode, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!authReady || snapshot.loading || verifyingCheckoutRef.current) return;
    if (isFirebaseConfigured && !user) return;

    const sessionId = localStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!sessionId) return;

    const processedKey = `${PROCESSED_CHECKOUT_PREFIX}${sessionId}`;
    if (localStorage.getItem(processedKey)) {
      localStorage.removeItem(PENDING_CHECKOUT_KEY);
      return;
    }

    verifyingCheckoutRef.current = true;
    localStorage.removeItem(PENDING_CHECKOUT_KEY);

    const verifyPayment = async () => {
      const idToken = user?.provider === 'firebase' ? await getFirebaseIdToken() : null;
      const result = await verifyStripeCheckoutSession({ sessionId, idToken });
      if (result.paid) {
        localStorage.setItem(processedKey, '1');
        if (!result.cloudCredited && !result.alreadyProcessed) {
          await repository.purchasePack(result.packId);
        }
        playFeedbackTone('spark');
        showToast(
          `Recarga confirmada: +${formatCurrencyAmount(result.amount)}.`,
          'success'
        );
      }
    };

    void verifyPayment()
      .catch((err) => {
        showToast(
          err instanceof Error ? err.message : 'No se pudo verificar el pago de Stripe.',
          'warning'
        );
      })
      .finally(() => {
        verifyingCheckoutRef.current = false;
      });
  }, [authReady, repository, showToast, snapshot.loading, user]);

  const addTasks = useCallback(
    async (drafts: ExtractedTaskDraft[], source: TaskSource) => {
      const created = await repository.addTasks(drafts, source);
      playFeedbackTone('check');
      return created;
    },
    [repository]
  );

  const toggleTask = useCallback(
    async (taskId: string) => {
      await repository.toggleTask(taskId);
      playFeedbackTone('check');
    },
    [repository]
  );

  const updateTask = useCallback(
    async (
      taskId: string,
      patch: Partial<Pick<NotebookTask, 'title' | 'category' | 'dueDate' | 'dueTime' | 'isExam' | 'notes'>>
    ) => {
      await repository.updateTask(taskId, patch);
      showToast('Tarea actualizada.', 'success');
    },
    [repository, showToast]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const target = tasksRef.current.find((t) => t.id === taskId) || null;
      await repository.deleteTask(taskId);
      if (target) {
        showToast('Tarea eliminada.', 'info', {
          label: 'Deshacer',
          onClick: () => {
            void repository.restoreTask(target);
          },
        });
      } else {
        showToast('Tarea eliminada.', 'info');
      }
    },
    [repository, showToast]
  );

  const clearCompletedTasks = useCallback(async () => {
    const removed = await repository.clearCompletedTasks();
    if (removed > 0) {
      showToast(
        removed === 1 ? '1 tarea tachada eliminada.' : `${removed} tareas tachadas eliminadas.`,
        'info'
      );
    }
    return removed;
  }, [repository, showToast]);

  const runWithSparkCharge = useCallback(
    async <T,>(
      cost: number,
      txType: SparkTransactionType,
      label: string,
      action: () => Promise<T>
    ): Promise<T> => {
      if (cost > 0) {
        await repository.spendSparks(cost, txType, label);
      }

      try {
        return await action();
      } catch (err) {
        if (cost > 0) {
          await repository.refundSparks(cost, `Reembolso: ${label}`);
        }
        throw err;
      }
    },
    [repository]
  );

  const claimDailyBonus = useCallback(async () => {
    const gained = await repository.claimDailyBonus();
    playFeedbackTone('spark');
    showToast(`+${formatCurrencyAmount(gained)} añadidas a tu saldo.`, 'success');
    return gained;
  }, [repository, showToast]);

  const purchasePack = useCallback(
    async (packId: string) => {
      const gained = await repository.purchasePack(packId);
      playFeedbackTone('spark');
      showToast(`Recarga completada: +${formatCurrencyAmount(gained)}.`, 'success');
      return gained;
    },
    [repository, showToast]
  );

  const creditReferralBonus = useCallback(async () => {
    const gained = await repository.creditReferralBonus();
    playFeedbackTone('spark');
    showToast(`¡Amigo unido! +${formatCurrencyAmount(gained)} acreditadas.`, 'success');
    return gained;
  }, [repository, showToast]);

  return {
    user,
    authReady,
    isFirebaseConfigured,
    tasks: snapshot.tasks,
    wallet: snapshot.wallet,
    loading: snapshot.loading,
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
  };
}
