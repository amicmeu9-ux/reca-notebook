import { BookOpen, Check, Home, Pencil, Trash2, User } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { NotebookTask, TaskCategory } from '../../types/notebook';
import { formatDueDateEs } from '../../utils/dateUtils';

interface TaskCardProps {
  task: NotebookTask;
  prominent?: boolean;
  hideCategoryLabel?: boolean;
  hideExamLabel?: boolean;
  hideTodayLabel?: boolean;
  onToggle: (taskId: string) => void;
  onEdit: (task: NotebookTask) => void;
  onDelete: (taskId: string) => void;
}

const SPARK_PARTICLES: Array<{ tx: string; ty: string; color: string; size: string }> = [
  { tx: '-16px', ty: '-14px', color: '#F5F5F7', size: 'h-1 w-1' },
  { tx: '15px', ty: '-16px', color: 'var(--nb-accent)', size: 'h-1 w-1' },
  { tx: '19px', ty: '2px', color: '#8E8E93', size: 'h-[3px] w-[3px]' },
  { tx: '11px', ty: '16px', color: '#F5F5F7', size: 'h-1 w-1' },
  { tx: '-14px', ty: '15px', color: 'var(--nb-accent)', size: 'h-[3px] w-[3px]' },
  { tx: '-19px', ty: '-1px', color: '#8E8E93', size: 'h-[3px] w-[3px]' },
];

function getCategoryIcon(category: TaskCategory) {
  if (category === 'Estudios') return BookOpen;
  if (category === 'Casa') return Home;
  return User;
}

export function TaskCard({
  task,
  prominent = false,
  hideCategoryLabel = false,
  hideExamLabel = false,
  hideTodayLabel = false,
  onToggle,
  onEdit,
  onDelete,
}: TaskCardProps) {
  const due = formatDueDateEs(task.dueDate, task.dueTime);
  const CategoryIcon = getCategoryIcon(task.category);

  const prevCompletedRef = useRef(task.completed);
  const [bursting, setBursting] = useState(false);

  useEffect(() => {
    const wasCompleted = prevCompletedRef.current;
    prevCompletedRef.current = task.completed;

    if (!wasCompleted && task.completed) {
      setBursting(true);
      const timer = window.setTimeout(() => setBursting(false), 560);
      return () => window.clearTimeout(timer);
    }
    if (!task.completed) {
      setBursting(false);
    }
  }, [task.completed]);

  const contextParts: string[] = [];
  if (!hideCategoryLabel) {
    contextParts.push(task.category);
  }

  const titleAlreadyMentionsExam = /\b(examen|parcial|control|final)\b/i.test(task.title);
  if (task.isExam && !hideExamLabel && !titleAlreadyMentionsExam) {
    contextParts.push('Examen');
  }

  let dueDisplayLabel: string | null = null;
  if (task.dueDate) {
    if (hideTodayLabel && due.tone === 'today') {
      dueDisplayLabel = task.dueTime || 'Hoy';
    } else {
      dueDisplayLabel = due.label;
    }
  }

  const urgencyDotClass = task.completed
    ? ''
    : due.tone === 'overdue' || (due.tone === 'today' && task.isExam)
      ? 'bg-[var(--nb-accent)]'
      : due.tone === 'today'
        ? 'bg-[#F5F5F7]'
        : due.tone === 'soon'
          ? 'bg-[#8E8E93]'
          : '';

  return (
    <div
      className={`nb-card nb-card-interactive group relative flex items-start gap-3.5 rounded-2xl transition-opacity duration-300 ${
        prominent ? 'px-4 py-4' : 'px-4 py-3.5'
      } ${task.completed ? 'opacity-45' : ''}`}
    >
      {/* Botón circular de un toque con micro-confeti geométrico al completar */}
      <button
        type="button"
        onClick={() => onToggle(task.id)}
        aria-label={task.completed ? `Desmarcar ${task.title}` : `Completar ${task.title}`}
        className="relative -ml-1.5 -mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-90"
      >
        {bursting &&
          SPARK_PARTICLES.map((spark, index) => (
            <span
              key={index}
              aria-hidden="true"
              style={
                {
                  '--tx': spark.tx,
                  '--ty': spark.ty,
                  backgroundColor: spark.color,
                } as CSSProperties
              }
              className={`animate-nb-spark pointer-events-none absolute left-1/2 top-1/2 rounded-full ${spark.size}`}
            />
          ))}
        <span
          className={`flex h-[19px] w-[19px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
            task.completed
              ? 'animate-nb-check border-[#F5F5F7] bg-[#F5F5F7] text-[#0D0D0F]'
              : 'border-[#3A3A40] bg-transparent hover:border-[#F5F5F7]'
          }`}
        >
          {task.completed && <Check className="h-3 w-3 stroke-[2.6]" aria-hidden="true" />}
        </span>
      </button>

      {/* Contenido principal */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2.5">
          <p
            onClick={() => onToggle(task.id)}
            className={`cursor-pointer line-clamp-2 text-[15px] font-medium leading-snug tracking-[-0.015em] transition-all duration-300 ${
              task.completed
                ? 'text-[#8E8E93] line-through decoration-[#8E8E93]/75'
                : 'text-[#F5F5F7]'
            }`}
          >
            {task.title}
          </p>

          <div className="flex shrink-0 items-center gap-0.5 opacity-80 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onEdit(task)}
              aria-label="Editar tarea"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8E8E93] transition hover:bg-[#1E1E22] hover:text-[#F5F5F7]"
            >
              <Pencil className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              aria-label="Eliminar tarea"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8E8E93] transition hover:bg-[#1E1E22] hover:text-[#F5F5F7]"
            >
              <Trash2 className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
            </button>
          </div>
        </div>

        {task.notes && (
          <p className="mt-1 line-clamp-1 text-xs font-normal leading-relaxed text-[#8E8E93]">
            {task.notes}
          </p>
        )}

        {(contextParts.length > 0 || dueDisplayLabel) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-normal text-[#8E8E93]">
            {contextParts.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <CategoryIcon className="h-3 w-3 shrink-0 stroke-[1.7]" aria-hidden="true" />
                <span>{contextParts.join(' · ')}</span>
              </span>
            )}

            {dueDisplayLabel && (
              <span
                className={`font-mono-tabular inline-flex items-center gap-1.5 ${
                  !task.completed && (due.tone === 'overdue' || due.tone === 'today')
                    ? 'text-[#F5F5F7]'
                    : 'text-[#8E8E93]'
                }`}
              >
                {urgencyDotClass && (
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyDotClass}`}
                  />
                )}
                <span>{dueDisplayLabel}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
