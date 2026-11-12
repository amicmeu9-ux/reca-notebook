import { ArrowRight, CalendarCheck2, CheckCircle2, GraduationCap, Mic, ScanLine } from 'lucide-react';
import { BRAND_CONFIG } from '../../config/brand';
import type { NotebookTask } from '../../types/notebook';
import { formatTodayHeaderEs, getTodayISO } from '../../utils/dateUtils';
import { SparkAmount } from '../common/SparkAmount';
import { TaskCard } from '../tasks/TaskCard';

interface HomeViewProps {
  tasks: NotebookTask[];
  onToggleTask: (taskId: string) => void;
  onEditTask: (task: NotebookTask) => void;
  onDeleteTask: (taskId: string) => void;
  onNavigateTab: (index: number) => void;
}

export function HomeView({
  tasks,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  onNavigateTab,
}: HomeViewProps) {
  const todayISO = getTodayISO();

  const todayTasks = tasks.filter(
    (t) => t.dueDate === todayISO || (t.dueDate !== null && t.dueDate < todayISO && !t.completed)
  );
  const todayPending = todayTasks.filter((t) => !t.completed);
  const todayCompleted = todayTasks.filter((t) => t.completed);

  const totalTodayCount = todayTasks.length;
  const progressPct = totalTodayCount > 0 ? Math.round((todayCompleted.length / totalTodayCount) * 100) : 100;

  const upcomingExams = tasks
    .filter((t) => !t.completed && t.isExam)
    .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))
    .slice(0, 4);

  const upcomingOther =
    todayPending.length === 0
      ? tasks
          .filter((t) => !t.completed && t.dueDate !== todayISO)
          .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))
          .slice(0, 3)
      : [];

  return (
    <div className="space-y-7 px-5 pb-28 pt-4">
      {/* Título principal y fecha */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-medium leading-tight tracking-[-0.025em] text-[#F5F5F7]">
            Lo que toca hoy
          </h1>
          <p className="mt-1 text-[13px] font-normal text-[#8E8E93]">
            {formatTodayHeaderEs()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab(1)}
          className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-[#242428] bg-[#161618] px-3.5 py-1.5 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#1C1C1F] active:scale-95"
        >
          Ver todas
          <ArrowRight className="h-3.5 w-3.5 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
        </button>
      </div>

      {/* Progreso minimalista del día */}
      <div className="nb-card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-[#F5F5F7]">
              {todayPending.length === 0
                ? 'Día despejado'
                : `${todayPending.length} ${todayPending.length === 1 ? 'pendiente hoy' : 'pendientes hoy'}`}
            </p>
            <p className="mt-1 text-xs font-normal text-[#8E8E93]">
              {totalTodayCount > 0
                ? `${todayCompleted.length} de ${totalTodayCount} completadas · toca el círculo para tachar`
                : 'Pulsa el micrófono para dictar tu primera tarea.'}
            </p>
          </div>
          <span className="font-mono-tabular shrink-0 text-xs font-medium text-[#F5F5F7]">
            {progressPct}%
          </span>
        </div>

        <div
          aria-hidden="true"
          className="mt-3.5 h-1 w-full overflow-hidden rounded-full bg-[#242428]"
        >
          <div
            className="h-full rounded-full bg-[var(--nb-accent)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Tarjetas de hoy */}
      <section className="space-y-3">
        {todayPending.length > 0 ? (
          todayPending.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              prominent
              onToggle={onToggleTask}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
            />
          ))
        ) : (
          <div className="nb-card flex flex-col items-center rounded-2xl px-5 py-8 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]">
              <CalendarCheck2 className="h-5 w-5 stroke-[1.7]" aria-hidden="true" />
            </div>
            <p className="font-display text-base font-medium text-[#F5F5F7]">Sin tareas pendientes hoy</p>
            <p className="mt-1 flex max-w-xs flex-wrap items-center justify-center gap-1 text-xs font-normal leading-relaxed text-[#8E8E93]">
              <span>Dicta una nota gratis (</span>
              <SparkAmount value={BRAND_CONFIG.costs.quickVoice} iconClassName="h-3 w-3" />
              <span>) o fotografía la pizarra.</span>
            </p>
          </div>
        )}
      </section>

      {/* Próximos exámenes */}
      {upcomingExams.length > 0 && (
        <section className="space-y-3 pt-1">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
              <h2 className="text-[13px] font-medium text-[#8E8E93]">
                Próximos exámenes
              </h2>
            </div>
            <span className="font-mono-tabular text-xs font-normal text-[#8E8E93]">
              {upcomingExams.length}
            </span>
          </div>

          <div className="space-y-3">
            {upcomingExams.map((exam) => (
              <TaskCard
                key={exam.id}
                task={exam}
                hideExamLabel
                onToggle={onToggleTask}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        </section>
      )}

      {/* Próximas tareas si hoy ya está libre */}
      {upcomingOther.length > 0 && (
        <section className="space-y-3 pt-1">
          <h2 className="px-0.5 text-[13px] font-medium text-[#8E8E93]">
            En los próximos días
          </h2>
          <div className="space-y-3">
            {upcomingOther.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={onToggleTask}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        </section>
      )}

      {/* Accesos rápidos */}
      <section className="grid grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={() => onNavigateTab(2)}
          className="nb-card nb-card-interactive flex flex-col items-start rounded-2xl p-4 text-left"
        >
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-xl border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]">
            <Mic className="h-4 w-4 stroke-[1.7]" aria-hidden="true" />
          </div>
          <span className="font-display text-sm font-medium text-[#F5F5F7]">Pulsa y habla</span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] font-normal text-[#8E8E93]">
            <span>Rápida</span>
            <SparkAmount value={BRAND_CONFIG.costs.quickVoice} iconClassName="h-2.5 w-2.5" className="text-[#F5F5F7]" />
            <span>·</span>
            <SparkAmount value={BRAND_CONFIG.costs.brainDump} iconClassName="h-2.5 w-2.5" className="text-[#F5F5F7]" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab(3)}
          className="nb-card nb-card-interactive flex flex-col items-start rounded-2xl p-4 text-left"
        >
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-xl border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]">
            <ScanLine className="h-4 w-4 stroke-[1.7]" aria-hidden="true" />
          </div>
          <span className="font-display text-sm font-medium text-[#F5F5F7]">Escanear pizarra</span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] font-normal text-[#8E8E93]">
            <span>Exámenes ·</span>
            <SparkAmount value={BRAND_CONFIG.costs.scanner} iconClassName="h-2.5 w-2.5" className="text-[#F5F5F7]" />
          </span>
        </button>
      </section>

      {todayCompleted.length > 0 && (
        <section className="space-y-3 pt-1">
          <div className="flex items-center gap-1.5 px-0.5 text-xs font-normal text-[#8E8E93]">
            <CheckCircle2 className="h-3.5 w-3.5 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
            <span>Completadas hoy ({todayCompleted.length})</span>
          </div>
          <div className="space-y-3">
            {todayCompleted.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={onToggleTask}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
