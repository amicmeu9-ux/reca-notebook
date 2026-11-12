import { BookOpen, CalendarPlus, ChevronDown, GraduationCap, Home as HomeIcon, Plus, Search, Trash2, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_META } from '../../config/brand';
import type { ExtractedTaskDraft, NotebookTask, TaskCategory, TaskSource } from '../../types/notebook';
import { getTodayISO } from '../../utils/dateUtils';
import { downloadTasksAsIcs } from '../../utils/icsUtils';
import { TaskCard } from '../tasks/TaskCard';

interface TasksViewProps {
  tasks: NotebookTask[];
  onToggleTask: (taskId: string) => void;
  onEditTask: (task: NotebookTask) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTasks: (drafts: ExtractedTaskDraft[], source: TaskSource) => Promise<NotebookTask[]>;
  onClearCompleted: () => Promise<number>;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function TasksView({
  tasks,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  onAddTasks,
  onClearCompleted,
  onNotify,
}: TasksViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<'Todas' | TaskCategory>('Todas');
  const [onlyExams, setOnlyExams] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsed, setCollapsed] = useState<Record<TaskCategory, boolean>>({
    Estudios: false,
    Casa: false,
    Personal: false,
  });

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCategory, setQuickCategory] = useState<TaskCategory>('Estudios');
  const [quickDate, setQuickDate] = useState(getTodayISO());
  const [quickIsExam, setQuickIsExam] = useState(false);

  const handleQuickAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    await onAddTasks(
      [
        {
          title: quickTitle.trim(),
          category: quickCategory,
          dueDate: quickDate || null,
          dueTime: null,
          isExam: quickIsExam,
          notes: null,
        },
      ],
      'manual'
    );
    setQuickTitle('');
    setQuickIsExam(false);
    setQuickOpen(false);
  };

  const filteredTasks = tasks.filter((t) => {
    if (selectedCategory !== 'Todas' && t.category !== selectedCategory) return false;
    if (onlyExams && !t.isExam) return false;
    if (!showCompleted && t.completed) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const hay = `${t.title} ${t.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const visibleCategories =
    selectedCategory === 'Todas' ? CATEGORIES : CATEGORIES.filter((c) => c === selectedCategory);

  const pendingTotal = tasks.filter((t) => !t.completed).length;
  const completedTotal = tasks.length - pendingTotal;
  const datedPendingTasks = tasks.filter((t) => !t.completed && Boolean(t.dueDate));

  const CategoryIcon = (cat: TaskCategory) =>
    cat === 'Estudios' ? BookOpen : cat === 'Casa' ? HomeIcon : User;

  return (
    <div className="space-y-6 px-5 pb-28 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-medium leading-tight tracking-[-0.025em] text-[#F5F5F7]">
            Tareas
          </h1>
          <p className="mt-1 text-[13px] font-normal text-[#8E8E93]">
            {pendingTotal} {pendingTotal === 1 ? 'pendiente' : 'pendientes'} · Toca el círculo para tachar
          </p>
        </div>

        <button
          type="button"
          onClick={() => setQuickOpen((v) => !v)}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3.5 py-1.5 text-xs font-medium text-[#0D0D0F] transition hover:bg-white active:scale-95"
        >
          <Plus className="h-3.5 w-3.5 stroke-[2]" aria-hidden="true" />
          Nueva
        </button>
      </div>

      {/* Formulario rápido manual */}
      {quickOpen && (
        <form onSubmit={handleQuickAdd} className="nb-card space-y-3.5 rounded-2xl p-4">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Ej: Resumen de Biología"
            autoFocus
            className="w-full rounded-xl border border-[#242428] bg-[#1E1E22] px-3.5 py-2.5 text-sm font-normal text-[#F5F5F7] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#F5F5F7]/30"
          />
          <div className="flex flex-wrap items-center gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setQuickCategory(cat)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  quickCategory === cat
                    ? 'bg-[#F5F5F7] text-[#0D0D0F]'
                    : 'border border-[#242428] bg-[#1E1E22] text-[#8E8E93] hover:text-[#F5F5F7]'
                }`}
              >
                {cat}
              </button>
            ))}
            <input
              type="date"
              value={quickDate}
              onChange={(e) => setQuickDate(e.target.value)}
              className="ml-auto rounded-xl border border-[#242428] bg-[#1E1E22] px-2.5 py-1.5 text-xs text-[#F5F5F7] [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#F5F5F7]/30"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-[#F5F5F7]">
              <input
                type="checkbox"
                checked={quickIsExam}
                onChange={(e) => setQuickIsExam(e.target.checked)}
                className="accent-[#F5F5F7]"
              />
              Es examen o parcial
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQuickOpen(false)}
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-[#8E8E93] hover:text-[#F5F5F7]"
              >
                Cerrar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#F5F5F7] px-4 py-1.5 text-xs font-medium text-[#0D0D0F] hover:bg-white"
              >
                Añadir
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Búsqueda y filtros */}
      <div className="space-y-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 stroke-[1.7] -translate-y-1/2 text-[#8E8E93]"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar examen, asignatura o recado..."
            className="w-full rounded-2xl border border-[#242428] bg-[#161618] py-2.5 pl-10 pr-4 text-sm font-normal text-[#F5F5F7] placeholder:text-[#8E8E93] focus:border-[#2E2E34] focus:bg-[#1C1C1F] focus:outline-none"
          />
        </div>

        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
          {(['Todas', ...CATEGORIES] as const).map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-[#F5F5F7] bg-[#F5F5F7] text-[#0D0D0F]'
                    : 'border-[#242428] bg-[#161618] text-[#8E8E93] hover:border-[#2E2E34] hover:text-[#F5F5F7]'
                }`}
              >
                {cat}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setOnlyExams((v) => !v)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              onlyExams
                ? 'border-[#F5F5F7] bg-[#F5F5F7] text-[#0D0D0F]'
                : 'border-[#242428] bg-[#161618] text-[#8E8E93] hover:border-[#2E2E34] hover:text-[#F5F5F7]'
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
            Exámenes
          </button>

          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              showCompleted
                ? 'border-[#2E2E34] bg-[#1E1E22] text-[#F5F5F7]'
                : 'border-[#242428] bg-[#161618] text-[#8E8E93] hover:text-[#F5F5F7]'
            }`}
          >
            {showCompleted ? 'Ocultar tachadas' : 'Ver tachadas'}
          </button>

          {datedPendingTasks.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const count = downloadTasksAsIcs(datedPendingTasks, 'reca-pendientes.ics');
                if (count > 0) {
                  onNotify(`Exportadas ${count} ${count === 1 ? 'tarea' : 'tareas'} (.ics).`, 'success');
                }
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#242428] bg-[#161618] px-3.5 py-1.5 text-xs font-medium text-[#8E8E93] transition hover:border-[#2E2E34] hover:text-[#F5F5F7]"
            >
              <CalendarPlus className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
              Exportar .ics
            </button>
          )}

          {completedTotal > 0 && (
            <button
              type="button"
              onClick={() => void onClearCompleted()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#242428] bg-[#161618] px-3.5 py-1.5 text-xs font-medium text-[#8E8E93] transition hover:border-[#2E2E34] hover:text-[#F5F5F7]"
            >
              <Trash2 className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
              Limpiar tachadas ({completedTotal})
            </button>
          )}
        </div>
      </div>

      {/* Grupos por categoría */}
      <div className="space-y-6">
        {visibleCategories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = CategoryIcon(cat);
          const groupTasks = filteredTasks
            .filter((t) => t.category === cat)
            .sort((a, b) => {
              if (a.completed !== b.completed) return a.completed ? 1 : -1;
              return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
            });

          const pendingInCat = groupTasks.filter((t) => !t.completed).length;
          const isCollapsed = collapsed[cat];

          return (
            <section key={cat} className="space-y-3">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-left transition hover:bg-[#161618]/70"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#242428] bg-[#161618] text-[#F5F5F7]">
                    <Icon className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
                  </span>
                  <div>
                    <span className="font-display text-sm font-medium text-[#F5F5F7]">{meta.label}</span>
                    <span className="ml-2 text-xs font-normal text-[#8E8E93]">{meta.description}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono-tabular rounded-full border border-[#242428] bg-[#161618] px-2.5 py-0.5 text-[11px] font-normal text-[#F5F5F7]">
                    {pendingInCat}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 stroke-[1.7] text-[#8E8E93] transition-transform ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                </div>
              </button>

              {!isCollapsed && (
                <div className="space-y-3">
                  {groupTasks.length > 0 ? (
                    groupTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        hideCategoryLabel
                        onToggle={onToggleTask}
                        onEdit={onEditTask}
                        onDelete={onDeleteTask}
                      />
                    ))
                  ) : (
                    <div className="nb-card rounded-2xl px-4 py-4 text-center text-xs font-normal text-[#8E8E93]">
                      Sin tareas en {meta.label}.
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
