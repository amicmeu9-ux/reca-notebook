import type { NotebookTask } from '../types/notebook';

const REMINDERS_ENABLED_KEY = 'reca_reminders_enabled_v1';
const SENT_REMINDERS_KEY = 'reca_notified_reminders_v1';
const MAX_SENT_HISTORY = 200;

export const STANDARD_REMINDER_LEAD_MS = 30 * 60 * 1000;
export const EXAM_REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

export interface DueReminder {
  key: string;
  task: NotebookTask;
  minutesLeft: number;
}

function parseTaskDueTimestamp(dueDate: string, dueTime: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(dueTime.trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed.getTime();
}

export function buildReminderKey(task: Pick<NotebookTask, 'id' | 'dueDate' | 'dueTime'>): string {
  return `${task.id}:${task.dueDate ?? ''}:${task.dueTime ?? ''}`;
}

/**
 * Devuelve tareas pendientes con hora dentro de su ventana de aviso (-2 h en exámenes, -30 min el resto).
 */
export function findDueReminders(
  tasks: NotebookTask[],
  nowMs: number,
  sentKeys: ReadonlySet<string>
): DueReminder[] {
  const due: DueReminder[] = [];

  for (const task of tasks) {
    if (task.completed || !task.dueDate || !task.dueTime) continue;

    const dueAtMs = parseTaskDueTimestamp(task.dueDate, task.dueTime);
    if (dueAtMs === null) continue;

    const msUntilDue = dueAtMs - nowMs;
    const leadMs = task.isExam ? EXAM_REMINDER_LEAD_MS : STANDARD_REMINDER_LEAD_MS;
    if (msUntilDue < 0 || msUntilDue > leadMs) continue;

    const key = buildReminderKey(task);
    if (sentKeys.has(key)) continue;

    due.push({
      key,
      task,
      minutesLeft: Math.max(0, Math.round(msUntilDue / 60_000)),
    });
  }

  return due;
}

export function formatReminderMessage(reminder: DueReminder): string {
  const prefix = reminder.task.isExam ? 'Examen' : 'Recordatorio';
  if (reminder.minutesLeft === 0) {
    return `${prefix}: empieza ahora «${reminder.task.title}»`;
  }
  return `${prefix} en ${reminder.minutesLeft} min: «${reminder.task.title}»`;
}

export function loadRemindersEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(REMINDERS_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRemindersEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMINDERS_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Ignorar errores de almacenamiento
  }
}

export function loadSentReminderIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SENT_REMINDERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

export function markReminderSent(reminderKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = Array.from(loadSentReminderIds()).filter((item) => item !== reminderKey);
    current.push(reminderKey);
    const trimmed = current.slice(-MAX_SENT_HISTORY);
    window.localStorage.setItem(SENT_REMINDERS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignorar errores de almacenamiento
  }
}
