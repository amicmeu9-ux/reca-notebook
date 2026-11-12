import { z } from 'zod';
import type { ExtractedTaskDraft, NotebookTask } from '../types/notebook';
import { getTodayISO } from './dateUtils';
import { summarizeTaskTitle } from './taskTitleUtils';

const BackupTaskSchema = z.object({
  title: z.string().trim().min(1),
  category: z.enum(['Estudios', 'Casa', 'Personal']).optional().default('Personal'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  isExam: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).nullable().optional().default(null),
});

export const BackupPayloadSchema = z.object({
  version: z.literal(1),
  app: z.string().min(1),
  exportedAt: z.string().min(1),
  tasks: z.array(BackupTaskSchema).max(500),
});

export type BackupParseResult =
  | { ok: true; tasks: ExtractedTaskDraft[]; exportedAt: string }
  | { ok: false; error: string };

/**
 * Serializa las tareas actuales a un JSON versionado para copia de seguridad.
 */
export function buildBackupJson(tasks: NotebookTask[]): string {
  const payload = {
    version: 1 as const,
    app: 'Reca',
    exportedAt: new Date().toISOString(),
    tasks: tasks.map((task) => ({
      title: task.title,
      category: task.category,
      dueDate: task.dueDate ?? null,
      dueTime: task.dueTime ?? null,
      isExam: Boolean(task.isExam),
      notes: task.notes ?? null,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Valida una copia JSON con Zod y devuelve borradores normalizados listos para importar.
 */
export function parseBackupJson(rawText: string): BackupParseResult {
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'El archivo no contiene JSON válido.' };
  }

  const parsed = BackupPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    return { ok: false, error: 'Formato de copia Reca no reconocido (se espera versión 1).' };
  }

  const normalizedTasks: ExtractedTaskDraft[] = parsed.data.tasks.map((item) => ({
    title: summarizeTaskTitle(item.title, item.title.slice(0, 48)),
    category: item.category,
    dueDate: item.dueDate,
    dueTime: item.dueTime,
    isExam: item.isExam,
    notes: item.notes && item.notes.length > 0 ? item.notes : null,
  }));

  return {
    ok: true,
    tasks: normalizedTasks,
    exportedAt: parsed.data.exportedAt,
  };
}

export function downloadBackupFile(tasks: NotebookTask[]): string {
  const filename = `reca-copia-${getTodayISO()}.json`;
  const content = buildBackupJson(tasks);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
