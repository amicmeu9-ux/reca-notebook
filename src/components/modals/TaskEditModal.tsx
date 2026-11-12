import { CalendarPlus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_META } from '../../config/brand';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import type { NotebookTask, TaskCategory } from '../../types/notebook';
import { downloadTasksAsIcs } from '../../utils/icsUtils';

interface TaskEditModalProps {
  task: NotebookTask | null;
  onClose: () => void;
  onSave: (
    taskId: string,
    patch: Partial<Pick<NotebookTask, 'title' | 'category' | 'dueDate' | 'dueTime' | 'isExam' | 'notes'>>
  ) => Promise<void>;
}

export function TaskEditModal({ task, onClose, onSave }: TaskEditModalProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('Estudios');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [isExam, setIsExam] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setCategory(task.category);
    setDueDate(task.dueDate || '');
    setDueTime(task.dueTime || '');
    setIsExam(task.isExam);
    setNotes(task.notes || '');
  }, [task]);

  const { handleBackdropClick } = useModalDismiss(Boolean(task), onClose);

  if (!task) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(task.id, {
        title: title.trim(),
        category,
        dueDate: dueDate || null,
        dueTime: dueTime || null,
        isExam,
        notes: notes.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0D0D0F]/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Editar tarea"
        className="nb-card w-full max-w-md rounded-t-3xl p-5 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-medium text-[#F5F5F7]">Editar tarea</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="rounded-full border border-[#242428] bg-[#1E1E22] p-1.5 text-[#8E8E93] transition hover:border-[#2E2E34] hover:text-[#F5F5F7]"
          >
            <X className="h-4 w-4 stroke-[1.7]" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-normal text-[#8E8E93]">Título</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-[#242428] bg-[#1E1E22] px-3.5 py-2.5 text-sm font-normal text-[#F5F5F7] outline-none transition focus:border-[#2E2E34]"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-normal text-[#8E8E93]">Categoría</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => {
                const active = category === cat;
                const meta = CATEGORY_META[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
                      active
                        ? 'bg-[#F5F5F7] text-[#0D0D0F]'
                        : 'border border-[#242428] bg-[#1E1E22] text-[#8E8E93] hover:border-[#2E2E34] hover:text-[#F5F5F7]'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#0D0D0F]' : meta.dotClass}`} />
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-normal text-[#8E8E93]">Fecha</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-[#242428] bg-[#1E1E22] px-3 py-2 text-sm text-[#F5F5F7] outline-none [color-scheme:dark] focus:border-[#2E2E34]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-normal text-[#8E8E93]">Hora</label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full rounded-xl border border-[#242428] bg-[#1E1E22] px-3 py-2 text-sm text-[#F5F5F7] outline-none [color-scheme:dark] focus:border-[#2E2E34]"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#242428] bg-[#1E1E22] px-3.5 py-2.5">
            <span className="text-sm font-normal text-[#F5F5F7]">Marcar como Examen / Parcial</span>
            <input
              type="checkbox"
              checked={isExam}
              onChange={(e) => setIsExam(e.target.checked)}
              className="h-4 w-4 accent-[#F5F5F7]"
            />
          </label>

          <div>
            <label className="mb-1.5 block text-xs font-normal text-[#8E8E93]">Notas / Aula</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Aula 204, temas 1-4..."
              className="w-full rounded-xl border border-[#242428] bg-[#1E1E22] px-3.5 py-2 text-sm font-normal text-[#F5F5F7] placeholder:text-[#8E8E93] outline-none transition focus:border-[#2E2E34]"
            />
          </div>

          {dueDate && (
            <button
              type="button"
              onClick={() =>
                downloadTasksAsIcs(
                  [
                    {
                      ...task,
                      title: title.trim() || task.title,
                      category,
                      dueDate,
                      dueTime: dueTime || null,
                      isExam,
                      notes: notes.trim() || null,
                    },
                  ],
                  `reca-${(title.trim() || 'evento').toLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 32)}.ics`
                )
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#242428] bg-[#1E1E22] py-2 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
            >
              <CalendarPlus className="h-3.5 w-3.5 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
              Añadir al calendario (.ics)
            </button>
          )}

          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#242428] bg-[#1E1E22] py-2.5 text-sm font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-[#F5F5F7] py-2.5 text-sm font-medium text-[#0D0D0F] transition hover:bg-white disabled:opacity-45"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
