import type { NotebookTask } from '../types/notebook';
import { addDaysISO } from './dateUtils';

function escapeIcsText(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatUtcStamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function addHoursHHmm(dateISO: string, timeHHmm: string, hoursToAdd: number): { date: string; time: string } {
  const [hStr, mStr] = timeHHmm.split(':');
  const base = new Date(`${dateISO}T${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')}:00`);
  base.setHours(base.getHours() + hoursToAdd);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  const hh = String(base.getHours()).padStart(2, '0');
  const mm = String(base.getMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

function compactDate(dateISO: string): string {
  return dateISO.replace(/-/g, '');
}

/**
 * Genera el contenido RFC 5545 (.ics) para una lista de tareas con fecha.
 */
export function buildIcsContent(tasks: NotebookTask[], calendarName = 'Reca'): string {
  const datedTasks = tasks.filter((t) => Boolean(t.dueDate));
  const stamp = formatUtcStamp();

  const events = datedTasks.map((task) => {
    const dueDate = task.dueDate as string;
    const summary = task.isExam ? `[Examen] ${task.title}` : task.title;
    const descriptionParts = [
      `Categoría: ${task.category}`,
      task.notes ? `Notas: ${task.notes}` : null,
      `Creado en ${calendarName}`,
    ].filter(Boolean);

    const lines = [
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(task.id)}@reca.app`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join('\n'))}`,
      `CATEGORIES:${escapeIcsText(task.category)}`,
    ];

    if (task.dueTime) {
      const startTime = task.dueTime.replace(':', '') + '00';
      const end = addHoursHHmm(dueDate, task.dueTime, 1);
      const endTime = end.time.replace(':', '') + '00';
      lines.push(`DTSTART:${compactDate(dueDate)}T${startTime}`);
      lines.push(`DTEND:${compactDate(end.date)}T${endTime}`);
      lines.push('BEGIN:VALARM');
      lines.push(task.isExam ? 'TRIGGER:-PT2H' : 'TRIGGER:-PT30M');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(summary)}`);
      lines.push('END:VALARM');
    } else {
      const nextDay = addDaysISO(dueDate, 1);
      lines.push(`DTSTART;VALUE=DATE:${compactDate(dueDate)}`);
      lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay)}`);
    }

    lines.push('END:VEVENT');
    return lines.join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reca//Agenda Personal//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Descarga un archivo .ics en el dispositivo del usuario.
 */
export function downloadTasksAsIcs(tasks: NotebookTask[], filename = 'reca-agenda.ics'): number {
  const dated = tasks.filter((t) => Boolean(t.dueDate));
  if (dated.length === 0) return 0;

  const content = buildIcsContent(dated);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return dated.length;
}
