export type TaskCategory = 'Estudios' | 'Casa' | 'Personal';

export type TaskSource = 'voice_quick' | 'brain_dump' | 'scanner' | 'manual';

export type TabId = 'home' | 'tasks' | 'record' | 'scanner' | 'wallet';

export interface NotebookTask {
  id: string;
  uid?: string;
  title: string;
  category: TaskCategory;
  /** Fecha en formato YYYY-MM-DD (o null si no tiene fecha límite) */
  dueDate: string | null;
  /** Hora opcional HH:mm */
  dueTime?: string | null;
  isExam: boolean;
  completed: boolean;
  completedAt?: string | null;
  source: TaskSource;
  notes?: string | null;
  createdAt: string;
}

export type SparkTransactionType =
  | 'welcome'
  | 'daily_claim'
  | 'referral'
  | 'pack_purchase'
  | 'brain_dump'
  | 'scanner'
  | 'refund';

export interface SparkTransaction {
  id: string;
  type: SparkTransactionType;
  amount: number;
  label: string;
  createdAt: string;
}

export interface WalletState {
  balance: number;
  lastDailyClaimAt: string | null;
  referralCode: string;
  referralCount: number;
  transactions: SparkTransaction[];
}

export interface AppUserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
  provider: 'local' | 'firebase';
}

export interface ExtractedTaskDraft {
  title: string;
  category: TaskCategory;
  dueDate: string | null;
  dueTime?: string | null;
  isExam: boolean;
  notes?: string | null;
}

export interface AiExtractionResponse {
  mode: 'gemini' | 'demo';
  model: string;
  summary: string;
  transcript?: string;
  tasks: ExtractedTaskDraft[];
}
