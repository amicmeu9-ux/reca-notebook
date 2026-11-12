export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(baseISO: string, days: number): string {
  const date = new Date(`${baseISO}T12:00:00`);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDaysFromToday(targetISO: string): number {
  const today = new Date(`${getTodayISO()}T12:00:00`);
  const target = new Date(`${targetISO}T12:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export interface FormattedDueDate {
  label: string;
  tone: 'overdue' | 'today' | 'soon' | 'normal' | 'none';
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatDueDateEs(dueDate: string | null, dueTime?: string | null): FormattedDueDate {
  if (!dueDate) {
    return { label: 'Sin fecha', tone: 'none' };
  }

  const diff = diffDaysFromToday(dueDate);
  const timeSuffix = dueTime ? ` · ${dueTime}` : '';

  if (diff < 0) {
    return {
      label: diff === -1 ? `Ayer${timeSuffix}` : `Hace ${Math.abs(diff)} d`,
      tone: 'overdue',
    };
  }
  if (diff === 0) {
    return { label: `Hoy${timeSuffix}`, tone: 'today' };
  }
  if (diff === 1) {
    return { label: `Mañana${timeSuffix}`, tone: 'soon' };
  }
  if (diff <= 5) {
    return { label: `En ${diff} días${timeSuffix}`, tone: 'soon' };
  }

  const [, mStr, dStr] = dueDate.split('-');
  const day = Number(dStr);
  const monthIdx = Math.max(0, Math.min(11, Number(mStr) - 1));
  return {
    label: `${day} ${MONTHS_SHORT[monthIdx]}${timeSuffix}`,
    tone: 'normal',
  };
}

export function formatTodayHeaderEs(): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export interface DailyCooldownStatus {
  canClaim: boolean;
  remainingMs: number;
  label: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function getDailyCooldownStatus(lastDailyClaimAt: string | null, nowMs = Date.now()): DailyCooldownStatus {
  if (!lastDailyClaimAt) {
    return { canClaim: true, remainingMs: 0, label: 'Disponible ahora' };
  }
  const lastMs = new Date(lastDailyClaimAt).getTime();
  if (Number.isNaN(lastMs)) {
    return { canClaim: true, remainingMs: 0, label: 'Disponible ahora' };
  }

  const elapsed = nowMs - lastMs;
  if (elapsed >= ONE_DAY_MS) {
    return { canClaim: true, remainingMs: 0, label: 'Disponible ahora' };
  }

  const remainingMs = ONE_DAY_MS - elapsed;
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    canClaim: false,
    remainingMs,
    label: `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`,
  };
}

export function formatRelativeTimeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 60_000) return 'Ahora';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}
