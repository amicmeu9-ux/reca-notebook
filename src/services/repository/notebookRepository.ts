import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { BRAND_CONFIG, formatCurrencyAmount } from '../../config/brand';
import type {
  ExtractedTaskDraft,
  NotebookTask,
  SparkTransaction,
  SparkTransactionType,
  TaskSource,
  WalletState,
} from '../../types/notebook';
import { addDaysISO, getDailyCooldownStatus, getTodayISO } from '../../utils/dateUtils';
import { getStarterTaskRename, summarizeTaskTitle } from '../../utils/taskTitleUtils';
import { getFirebaseServices } from '../firebase/config';

export interface NotebookSnapshot {
  tasks: NotebookTask[];
  wallet: WalletState;
  loading: boolean;
}

export interface NotebookRepository {
  subscribe(onUpdate: (snapshot: NotebookSnapshot) => void): () => void;
  addTasks(drafts: ExtractedTaskDraft[], source: TaskSource): Promise<NotebookTask[]>;
  toggleTask(taskId: string): Promise<void>;
  updateTask(taskId: string, patch: Partial<Pick<NotebookTask, 'title' | 'category' | 'dueDate' | 'dueTime' | 'isExam' | 'notes'>>): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  restoreTask(task: NotebookTask): Promise<void>;
  clearCompletedTasks(): Promise<number>;
  spendSparks(amount: number, type: SparkTransactionType, label: string): Promise<void>;
  refundSparks(amount: number, label: string): Promise<void>;
  claimDailyBonus(): Promise<number>;
  purchasePack(packId: string): Promise<number>;
  creditReferralBonus(reasonLabel?: string): Promise<number>;
}

const LOCAL_STORAGE_KEY = 'reca_state_v1';
const LEGACY_STORAGE_KEY = 'notebook_state_v1';
const TITLE_MIGRATION_KEY = 'notebook_titles_polished_v2';
const CLOUD_MIGRATED_PREFIX = 'reca_migrated_uid_';

const STRICT_ISO_RE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/;
const STRICT_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const STRICT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_SOURCES = new Set<TaskSource>(['voice_quick', 'brain_dump', 'scanner', 'manual']);

function buildFirestoreCreateDoc(task: NotebookTask, uid: string, now: string): NotebookTask {
  return {
    id: task.id || createId('task'),
    uid,
    title: (summarizeTaskTitle(task.title) || 'Tarea').slice(0, 500),
    category: task.category === 'Estudios' || task.category === 'Casa' ? task.category : 'Personal',
    dueDate: task.dueDate && STRICT_DATE_RE.test(task.dueDate) ? task.dueDate : null,
    dueTime: task.dueTime && STRICT_TIME_RE.test(task.dueTime) ? task.dueTime : null,
    isExam: Boolean(task.isExam),
    completed: false,
    completedAt: null,
    source: VALID_SOURCES.has(task.source) ? task.source : 'manual',
    notes: task.notes ? String(task.notes).slice(0, 2000) : null,
    createdAt: task.createdAt && STRICT_ISO_RE.test(task.createdAt) ? task.createdAt : now,
  };
}

function readPendingLocalTasks(): NotebookTask[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { tasks?: NotebookTask[] };
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.filter((t) => !t.completed).slice(0, 200);
  } catch {
    return [];
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateReferralCode(seed = ''): string {
  const clean = seed.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RC-${clean || rand}${rand.slice(0, 2)}`;
}

function migrateWalletBranding(wallet: WalletState): WalletState {
  const referralCode = wallet.referralCode.startsWith('NB-')
    ? `RC-${wallet.referralCode.slice(3)}`
    : wallet.referralCode;
  const transactions = wallet.transactions.map((tx) =>
    tx.type === 'welcome' && tx.label.includes('Notebook')
      ? { ...tx, label: `Regalo de bienvenida (${BRAND_CONFIG.appName})` }
      : tx
  );
  return { ...wallet, referralCode, transactions };
}

function createInitialLocalState(): { tasks: NotebookTask[]; wallet: WalletState } {
  const today = getTodayISO();
  const now = new Date().toISOString();

  const starterTasks: NotebookTask[] = [
    {
      id: createId('task'),
      title: 'Repasar Cálculo',
      category: 'Estudios',
      dueDate: today,
      dueTime: '18:00',
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'manual',
      notes: 'Tema 4 · 5 ejercicios pendientes',
      createdAt: now,
    },
    {
      id: createId('task'),
      title: 'Parcial de Física',
      category: 'Estudios',
      dueDate: addDaysISO(today, 3),
      dueTime: '10:30',
      isExam: true,
      completed: false,
      completedAt: null,
      source: 'scanner',
      notes: 'Fundamentos · Aula 204 · Formulario',
      createdAt: now,
    },
    {
      id: createId('task'),
      title: 'Café y cuaderno',
      category: 'Casa',
      dueDate: today,
      dueTime: null,
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'voice_quick',
      notes: null,
      createdAt: now,
    },
    {
      id: createId('task'),
      title: 'Cita dental',
      category: 'Personal',
      dueDate: addDaysISO(today, 1),
      dueTime: null,
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'voice_quick',
      notes: null,
      createdAt: now,
    },
  ];

  const wallet: WalletState = {
    balance: BRAND_CONFIG.currency.initialBalance,
    lastDailyClaimAt: null,
    referralCode: generateReferralCode(),
    referralCount: 0,
    transactions: [
      {
        id: createId('tx'),
        type: 'welcome',
        amount: BRAND_CONFIG.currency.initialBalance,
        label: `Regalo de bienvenida (${BRAND_CONFIG.appName})`,
        createdAt: now,
      },
    ],
  };

  return { tasks: starterTasks, wallet };
}

class LocalNotebookRepository implements NotebookRepository {
  private listeners = new Set<(snapshot: NotebookSnapshot) => void>();

  private loadState(): { tasks: NotebookTask[]; wallet: WalletState } {
    try {
      const currentRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
      const legacyRaw = !currentRaw ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
      const raw = currentRaw || legacyRaw;
      if (!raw) {
        const initial = createInitialLocalState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
        return initial;
      }
      const parsed = JSON.parse(raw) as { tasks?: NotebookTask[]; wallet?: WalletState };
      if (!parsed.wallet || !Array.isArray(parsed.tasks)) {
        const initial = createInitialLocalState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
        return initial;
      }

      const nextWallet = legacyRaw ? migrateWalletBranding(parsed.wallet) : parsed.wallet;

      if (!localStorage.getItem(TITLE_MIGRATION_KEY)) {
        const migratedTasks = parsed.tasks.map((t) => {
          const renamed = getStarterTaskRename(t.title);
          if (renamed) {
            return {
              ...t,
              title: renamed.title,
              notes: renamed.notes !== undefined ? renamed.notes : t.notes,
            };
          }
          return {
            ...t,
            title: summarizeTaskTitle(t.title, 'Nueva tarea'),
          };
        });
        const nextState = { tasks: migratedTasks, wallet: nextWallet };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextState));
        localStorage.setItem(TITLE_MIGRATION_KEY, '1');
        return nextState;
      }

      if (legacyRaw) {
        const migrated = { tasks: parsed.tasks, wallet: nextWallet };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }

      return { tasks: parsed.tasks, wallet: nextWallet };
    } catch {
      return createInitialLocalState();
    }
  }

  private saveState(state: { tasks: NotebookTask[]; wallet: WalletState }): void {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    const snapshot: NotebookSnapshot = {
      tasks: state.tasks,
      wallet: state.wallet,
      loading: false,
    };
    this.listeners.forEach((cb) => cb(snapshot));
  }

  subscribe(onUpdate: (snapshot: NotebookSnapshot) => void): () => void {
    this.listeners.add(onUpdate);
    const current = this.loadState();
    onUpdate({ ...current, loading: false });
    return () => {
      this.listeners.delete(onUpdate);
    };
  }

  async addTasks(drafts: ExtractedTaskDraft[], source: TaskSource): Promise<NotebookTask[]> {
    const state = this.loadState();
    const now = new Date().toISOString();
    const created: NotebookTask[] = drafts.map((d) => ({
      id: createId('task'),
      title: summarizeTaskTitle(d.title),
      category: d.category,
      dueDate: d.dueDate ?? null,
      dueTime: d.dueTime ?? null,
      isExam: Boolean(d.isExam),
      completed: false,
      completedAt: null,
      source,
      notes: d.notes ?? null,
      createdAt: now,
    }));

    state.tasks = [...created, ...state.tasks];
    this.saveState(state);
    return created;
  }

  async toggleTask(taskId: string): Promise<void> {
    const state = this.loadState();
    const now = new Date().toISOString();
    state.tasks = state.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            completed: !t.completed,
            completedAt: !t.completed ? now : null,
          }
        : t
    );
    this.saveState(state);
  }

  async updateTask(
    taskId: string,
    patch: Partial<Pick<NotebookTask, 'title' | 'category' | 'dueDate' | 'dueTime' | 'isExam' | 'notes'>>
  ): Promise<void> {
    const state = this.loadState();
    state.tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
    this.saveState(state);
  }

  async deleteTask(taskId: string): Promise<void> {
    const state = this.loadState();
    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    this.saveState(state);
  }

  async restoreTask(task: NotebookTask): Promise<void> {
    const state = this.loadState();
    if (state.tasks.some((t) => t.id === task.id)) return;
    state.tasks = [task, ...state.tasks];
    this.saveState(state);
  }

  async clearCompletedTasks(): Promise<number> {
    const state = this.loadState();
    const nextTasks = state.tasks.filter((t) => !t.completed);
    const removedCount = state.tasks.length - nextTasks.length;
    if (removedCount === 0) return 0;
    state.tasks = nextTasks;
    this.saveState(state);
    return removedCount;
  }

  async spendSparks(amount: number, type: SparkTransactionType, label: string): Promise<void> {
    if (amount <= 0) return;
    const state = this.loadState();
    if (state.wallet.balance < amount) {
      throw new Error(
        `Necesitas ${formatCurrencyAmount(amount)} y tienes ${formatCurrencyAmount(state.wallet.balance)}.`
      );
    }
    const tx: SparkTransaction = {
      id: createId('tx'),
      type,
      amount: -amount,
      label,
      createdAt: new Date().toISOString(),
    };
    state.wallet = {
      ...state.wallet,
      balance: state.wallet.balance - amount,
      transactions: [tx, ...state.wallet.transactions].slice(0, 40),
    };
    this.saveState(state);
  }

  async refundSparks(amount: number, label: string): Promise<void> {
    if (amount <= 0) return;
    const state = this.loadState();
    const tx: SparkTransaction = {
      id: createId('tx'),
      type: 'refund',
      amount,
      label,
      createdAt: new Date().toISOString(),
    };
    state.wallet = {
      ...state.wallet,
      balance: state.wallet.balance + amount,
      transactions: [tx, ...state.wallet.transactions].slice(0, 40),
    };
    this.saveState(state);
  }

  async claimDailyBonus(): Promise<number> {
    const state = this.loadState();
    const status = getDailyCooldownStatus(state.wallet.lastDailyClaimAt);
    if (!status.canClaim) {
      throw new Error(
        `Ya reclamaste tus ${BRAND_CONFIG.currency.namePlural.toLowerCase()} de hoy. Vuelve en ${status.label}.`
      );
    }
    const bonus = BRAND_CONFIG.currency.dailyBonus;
    const now = new Date().toISOString();
    const tx: SparkTransaction = {
      id: createId('tx'),
      type: 'daily_claim',
      amount: bonus,
      label: 'Recompensa diaria gratuita',
      createdAt: now,
    };
    state.wallet = {
      ...state.wallet,
      balance: state.wallet.balance + bonus,
      lastDailyClaimAt: now,
      transactions: [tx, ...state.wallet.transactions].slice(0, 40),
    };
    this.saveState(state);
    return bonus;
  }

  async purchasePack(packId: string): Promise<number> {
    const pack = BRAND_CONFIG.packs.find((p) => p.id === packId);
    if (!pack) {
      throw new Error('Paquete no encontrado.');
    }
    const state = this.loadState();
    const tx: SparkTransaction = {
      id: createId('tx'),
      type: 'pack_purchase',
      amount: pack.amount,
      label: `Recarga ${pack.title} (${pack.priceLabel})`,
      createdAt: new Date().toISOString(),
    };
    state.wallet = {
      ...state.wallet,
      balance: state.wallet.balance + pack.amount,
      transactions: [tx, ...state.wallet.transactions].slice(0, 40),
    };
    this.saveState(state);
    return pack.amount;
  }

  async creditReferralBonus(reasonLabel?: string): Promise<number> {
    const state = this.loadState();
    const bonus = BRAND_CONFIG.currency.referralBonus;
    const label = String(reasonLabel || '').trim().slice(0, 120) || 'Recompensa por amigo invitado';
    const tx: SparkTransaction = {
      id: createId('tx'),
      type: 'referral',
      amount: bonus,
      label,
      createdAt: new Date().toISOString(),
    };
    state.wallet = {
      ...state.wallet,
      balance: state.wallet.balance + bonus,
      referralCount: state.wallet.referralCount + 1,
      transactions: [tx, ...state.wallet.transactions].slice(0, 40),
    };
    this.saveState(state);
    return bonus;
  }
}

class FirestoreNotebookRepository implements NotebookRepository {
  private readonly db: Firestore;
  private readonly uid: string;

  constructor(db: Firestore, uid: string) {
    this.db = db;
    this.uid = uid;
  }

  private userDocRef() {
    return doc(this.db, 'users', this.uid);
  }

  private tasksCollectionRef() {
    return collection(this.db, 'users', this.uid, 'tasks');
  }

  private txCollectionRef() {
    return collection(this.db, 'users', this.uid, 'transactions');
  }

  private async ensureUserInitialized(): Promise<void> {
    const userRef = this.userDocRef();
    const txId = createId('tx');
    const txRef = doc(this.db, 'users', this.uid, 'transactions', txId);
    let createdNewAccount = false;

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(userRef);
      if (snap.exists()) return;
      createdNewAccount = true;

      const now = new Date().toISOString();
      tx.set(userRef, {
        uid: this.uid,
        sparkBalance: BRAND_CONFIG.currency.initialBalance,
        lastDailyClaimAt: null,
        referralCode: generateReferralCode(this.uid),
        referralCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      tx.set(txRef, {
        uid: this.uid,
        type: 'welcome',
        amount: BRAND_CONFIG.currency.initialBalance,
        label: `Regalo de bienvenida (${BRAND_CONFIG.appName})`,
        createdAt: now,
      });
    });

    if (createdNewAccount) {
      await this.migrateLocalTasksOnce();
    }
  }

  private async migrateLocalTasksOnce(): Promise<void> {
    const flagKey = `${CLOUD_MIGRATED_PREFIX}${this.uid}`;
    try {
      if (localStorage.getItem(flagKey) === '1') return;
      const localTasks = readPendingLocalTasks();
      if (localTasks.length === 0) {
        localStorage.setItem(flagKey, '1');
        return;
      }

      const now = new Date().toISOString();
      const batch = writeBatch(this.db);
      for (const localTask of localTasks) {
        const cleanDoc = buildFirestoreCreateDoc(localTask, this.uid, now);
        batch.set(doc(this.db, 'users', this.uid, 'tasks', cleanDoc.id), cleanDoc);
      }
      await batch.commit();
      localStorage.setItem(flagKey, '1');
    } catch {
      // Silencioso para no bloquear la carga inicial si la migración falla
    }
  }

  subscribe(onUpdate: (snapshot: NotebookSnapshot) => void): () => void {
    let tasks: NotebookTask[] = [];
    let wallet: WalletState = {
      balance: BRAND_CONFIG.currency.initialBalance,
      lastDailyClaimAt: null,
      referralCode: generateReferralCode(this.uid),
      referralCount: 0,
      transactions: [],
    };
    let userLoaded = false;
    let tasksLoaded = false;

    const emit = () => {
      onUpdate({
        tasks,
        wallet,
        loading: !(userLoaded && tasksLoaded),
      });
    };

    void this.ensureUserInitialized().catch((err) => {
      console.error('Error inicializando usuario en Firestore:', err);
    });

    const unsubUser = onSnapshot(this.userDocRef(), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        wallet = {
          ...wallet,
          balance: typeof data.sparkBalance === 'number' ? data.sparkBalance : BRAND_CONFIG.currency.initialBalance,
          lastDailyClaimAt: typeof data.lastDailyClaimAt === 'string' ? data.lastDailyClaimAt : null,
          referralCode: typeof data.referralCode === 'string' ? data.referralCode : generateReferralCode(this.uid),
          referralCount: typeof data.referralCount === 'number' ? data.referralCount : 0,
        };
      }
      userLoaded = true;
      emit();
    });

    const tasksQuery = query(this.tasksCollectionRef(), orderBy('createdAt', 'desc'));
    const unsubTasks = onSnapshot(tasksQuery, (snap) => {
      tasks = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          uid: this.uid,
          title: String(data.title || ''),
          category: data.category === 'Estudios' || data.category === 'Casa' ? data.category : 'Personal',
          dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
          dueTime: typeof data.dueTime === 'string' ? data.dueTime : null,
          isExam: Boolean(data.isExam),
          completed: Boolean(data.completed),
          completedAt: typeof data.completedAt === 'string' ? data.completedAt : null,
          source: data.source || 'manual',
          notes: typeof data.notes === 'string' ? data.notes : null,
          createdAt: String(data.createdAt || new Date().toISOString()),
        };
      });
      tasksLoaded = true;
      emit();
    });

    const txQuery = query(this.txCollectionRef(), orderBy('createdAt', 'desc'), limit(30));
    const unsubTx = onSnapshot(txQuery, (snap) => {
      wallet = {
        ...wallet,
        transactions: snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type || 'welcome',
            amount: Number(data.amount || 0),
            label: String(data.label || ''),
            createdAt: String(data.createdAt || new Date().toISOString()),
          };
        }),
      };
      emit();
    });

    return () => {
      unsubUser();
      unsubTasks();
      unsubTx();
    };
  }

  async addTasks(drafts: ExtractedTaskDraft[], source: TaskSource): Promise<NotebookTask[]> {
    const batch = writeBatch(this.db);
    const now = new Date().toISOString();
    const created: NotebookTask[] = [];

    for (const draft of drafts) {
      const id = createId('task');
      const taskRef = doc(this.db, 'users', this.uid, 'tasks', id);
      const task: NotebookTask = {
        id,
        uid: this.uid,
        title: summarizeTaskTitle(draft.title),
        category: draft.category,
        dueDate: draft.dueDate ?? null,
        dueTime: draft.dueTime ?? null,
        isExam: Boolean(draft.isExam),
        completed: false,
        completedAt: null,
        source,
        notes: draft.notes ?? null,
        createdAt: now,
      };
      batch.set(taskRef, task);
      created.push(task);
    }

    await batch.commit();
    return created;
  }

  async toggleTask(taskId: string): Promise<void> {
    const taskRef = doc(this.db, 'users', this.uid, 'tasks', taskId);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(taskRef);
      if (!snap.exists()) return;
      const current = Boolean(snap.data().completed);
      tx.update(taskRef, {
        completed: !current,
        completedAt: !current ? new Date().toISOString() : null,
      });
    });
  }

  async updateTask(
    taskId: string,
    patch: Partial<Pick<NotebookTask, 'title' | 'category' | 'dueDate' | 'dueTime' | 'isExam' | 'notes'>>
  ): Promise<void> {
    const taskRef = doc(this.db, 'users', this.uid, 'tasks', taskId);
    await updateDoc(taskRef, patch);
  }

  async deleteTask(taskId: string): Promise<void> {
    await deleteDoc(doc(this.db, 'users', this.uid, 'tasks', taskId));
  }

  async restoreTask(task: NotebookTask): Promise<void> {
    const now = new Date().toISOString();
    const cleanDoc = buildFirestoreCreateDoc(task, this.uid, now);
    const taskRef = doc(this.db, 'users', this.uid, 'tasks', cleanDoc.id);
    await setDoc(taskRef, cleanDoc);
    if (task.completed) {
      const completedAt =
        task.completedAt && STRICT_ISO_RE.test(task.completedAt) ? task.completedAt : now;
      await updateDoc(taskRef, { completed: true, completedAt });
    }
  }

  async clearCompletedTasks(): Promise<number> {
    const snap = await getDocs(this.tasksCollectionRef());
    const completedDocs = snap.docs.filter((d) => Boolean(d.data().completed));
    if (completedDocs.length === 0) return 0;

    for (let i = 0; i < completedDocs.length; i += 400) {
      const batch = writeBatch(this.db);
      for (const item of completedDocs.slice(i, i + 400)) {
        batch.delete(item.ref);
      }
      await batch.commit();
    }
    return completedDocs.length;
  }

  async spendSparks(amount: number, type: SparkTransactionType, label: string): Promise<void> {
    if (amount <= 0) return;
    const userRef = this.userDocRef();
    const txRef = doc(this.db, 'users', this.uid, 'transactions', createId('tx'));

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) {
        throw new Error('Perfil de usuario no inicializado.');
      }
      const currentBalance = Number(snap.data().sparkBalance || 0);
      if (currentBalance < amount) {
        throw new Error(
          `Necesitas ${formatCurrencyAmount(amount)} y tienes ${formatCurrencyAmount(currentBalance)}.`
        );
      }
      const now = new Date().toISOString();
      tx.update(userRef, {
        sparkBalance: currentBalance - amount,
        updatedAt: now,
      });
      tx.set(txRef, {
        uid: this.uid,
        type,
        amount: -amount,
        label,
        createdAt: now,
      });
    });
  }

  async refundSparks(amount: number, label: string): Promise<void> {
    if (amount <= 0) return;
    const userRef = this.userDocRef();
    const txRef = doc(this.db, 'users', this.uid, 'transactions', createId('tx'));

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) return;
      const currentBalance = Number(snap.data().sparkBalance || 0);
      const now = new Date().toISOString();
      tx.update(userRef, {
        sparkBalance: currentBalance + amount,
        updatedAt: now,
      });
      tx.set(txRef, {
        uid: this.uid,
        type: 'refund',
        amount,
        label,
        createdAt: now,
      });
    });
  }

  async claimDailyBonus(): Promise<number> {
    const userRef = this.userDocRef();
    const txRef = doc(this.db, 'users', this.uid, 'transactions', createId('tx'));
    const bonus = BRAND_CONFIG.currency.dailyBonus;

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: this.uid,
          sparkBalance: BRAND_CONFIG.currency.initialBalance,
          lastDailyClaimAt: null,
          referralCode: generateReferralCode(this.uid),
          referralCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      const data = snap.exists() ? snap.data() : { sparkBalance: BRAND_CONFIG.currency.initialBalance, lastDailyClaimAt: null };
      const status = getDailyCooldownStatus(data.lastDailyClaimAt || null);
      if (!status.canClaim) {
        throw new Error(
          `Ya reclamaste tus ${BRAND_CONFIG.currency.namePlural.toLowerCase()} de hoy. Vuelve en ${status.label}.`
        );
      }
      const now = new Date().toISOString();
      tx.update(userRef, {
        sparkBalance: Number(data.sparkBalance || 0) + bonus,
        lastDailyClaimAt: now,
        updatedAt: now,
      });
      tx.set(txRef, {
        uid: this.uid,
        type: 'daily_claim',
        amount: bonus,
        label: 'Recompensa diaria gratuita',
        createdAt: now,
      });
    });

    return bonus;
  }

  async purchasePack(packId: string): Promise<number> {
    const pack = BRAND_CONFIG.packs.find((p) => p.id === packId);
    if (!pack) {
      throw new Error('Paquete no encontrado.');
    }
    const userRef = this.userDocRef();
    const txRef = doc(this.db, 'users', this.uid, 'transactions', createId('tx'));

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(userRef);
      const currentBalance = snap.exists() ? Number(snap.data().sparkBalance || 0) : 0;
      const now = new Date().toISOString();
      tx.update(userRef, {
        sparkBalance: currentBalance + pack.amount,
        updatedAt: now,
      });
      tx.set(txRef, {
        uid: this.uid,
        type: 'pack_purchase',
        amount: pack.amount,
        label: `Recarga ${pack.title} (${pack.priceLabel})`,
        createdAt: now,
      });
    });

    return pack.amount;
  }

  async creditReferralBonus(reasonLabel?: string): Promise<number> {
    const bonus = BRAND_CONFIG.currency.referralBonus;
    const label = String(reasonLabel || '').trim().slice(0, 120) || 'Recompensa por amigo invitado';
    const userRef = this.userDocRef();
    const txRef = doc(this.db, 'users', this.uid, 'transactions', createId('tx'));

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) return;
      const currentBalance = Number(snap.data().sparkBalance || 0);
      const currentCount = Number(snap.data().referralCount || 0);
      const now = new Date().toISOString();
      tx.update(userRef, {
        sparkBalance: currentBalance + bonus,
        referralCount: currentCount + 1,
        updatedAt: now,
      });
      tx.set(txRef, {
        uid: this.uid,
        type: 'referral',
        amount: bonus,
        label,
        createdAt: now,
      });
    });

    return bonus;
  }
}

const localRepoSingleton = new LocalNotebookRepository();

export function createRepositoryForUser(uid: string, provider: 'local' | 'firebase'): NotebookRepository {
  if (provider === 'firebase') {
    const services = getFirebaseServices();
    if (services) {
      return new FirestoreNotebookRepository(services.db, uid);
    }
  }
  return localRepoSingleton;
}
