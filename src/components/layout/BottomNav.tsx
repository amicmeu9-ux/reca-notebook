import { CheckSquare, Home, Mic, ScanLine, Wallet } from 'lucide-react';
import type { TabId } from '../../types/notebook';

interface BottomNavProps {
  activeIndex: number;
  swipeProgress?: number;
  pendingCount: number;
  isRecording: boolean;
  handsFreeArmed: boolean;
  onSelectTab: (index: number) => void;
}

const NAV_ITEMS: Array<{ id: TabId; label: string }> = [
  { id: 'home', label: 'Inicio' },
  { id: 'tasks', label: 'Tareas' },
  { id: 'record', label: 'Grabar' },
  { id: 'scanner', label: 'Escáner' },
  { id: 'wallet', label: 'Cartera' },
];

export function BottomNav({
  activeIndex,
  swipeProgress,
  pendingCount,
  isRecording,
  handsFreeArmed,
  onSelectTab,
}: BottomNavProps) {
  const indicatorProgress =
    typeof swipeProgress === 'number' ? Math.max(0, Math.min(4, swipeProgress)) : activeIndex;
  // Al cruzar el botón circular central (idx 2), encoge sutilmente la cápsula para adaptarse sin sobresalir tras el círculo
  const centerProximity = Math.max(0, 1 - Math.abs(indicatorProgress - 2));
  const pillInsetX = 4 + centerProximity * 3;
  const pillTop = centerProximity * 22;
  const pillRadius = 20 - centerProximity * 3;
  const pillOpacity = 1 - centerProximity * 0.35;

  return (
    <nav
      aria-label="Navegación principal"
      className="pointer-events-none absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30"
    >
      <div className="pointer-events-auto relative rounded-[28px] border border-white/[0.11] border-t-white/[0.2] bg-[#161618]/74 px-1.5 pb-2 pt-2 backdrop-blur-2xl shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)]">
        {/* Indicador luminoso flotante con adaptación suave de contorno */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1.5 bottom-1.5 top-1.5"
        >
          <div
            style={{ transform: `translateX(${indicatorProgress * 100}%)` }}
            className="relative flex h-full w-[20%] flex-col items-center justify-end transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          >
            <span
              style={{
                left: `${pillInsetX}px`,
                right: `${pillInsetX}px`,
                top: `${pillTop}px`,
                bottom: '0px',
                borderRadius: `${pillRadius}px`,
                opacity: pillOpacity,
              }}
              className="absolute border border-white/[0.08] bg-white/[0.06] transition-[left,right,top,border-radius,opacity] duration-150 ease-out motion-reduce:transition-none"
            />
            <span className="relative h-[2.5px] w-5 rounded-full bg-[var(--nb-accent)] shadow-[0_-1px_6px_rgba(255,46,67,0.5)]" />
          </div>
        </div>

        <div className="relative grid grid-cols-5 items-end">
          {NAV_ITEMS.map((item, idx) => {
            const isActive = activeIndex === idx;

            if (item.id === 'record') {
              return (
                <div key={item.id} className="flex flex-col items-center justify-end pb-1">
                  <button
                    type="button"
                    onClick={() => onSelectTab(idx)}
                    aria-label="Ir a grabar nota o vaciado mental"
                    aria-current={isActive ? 'page' : undefined}
                    className="relative -mt-7 flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-b from-[#FF4659] to-[var(--nb-accent)] text-[var(--nb-accent-fg)] ring-[3px] ring-[#0D0D0F]/85 shadow-[0_10px_24px_-6px_rgba(255,46,67,0.52),inset_0_1px_0_rgba(255,255,255,0.28)] transition-transform duration-150 ease-out hover:brightness-105 active:scale-[0.94]"
                  >
                    {(isRecording || handsFreeArmed) && (
                      <span className="animate-nb-ring absolute inset-0 rounded-full border-2 border-[var(--nb-accent)] opacity-75" />
                    )}
                    <Mic className="h-5 w-5 stroke-[1.9]" aria-hidden="true" />
                  </button>
                  <span
                    className={`mt-1 text-[11px] font-medium tracking-tight transition-colors ${
                      isActive ? 'text-[#F5F5F7]' : 'text-[#8E8E93]'
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
              );
            }

            const Icon =
              item.id === 'home'
                ? Home
                : item.id === 'tasks'
                  ? CheckSquare
                  : item.id === 'scanner'
                    ? ScanLine
                    : Wallet;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(idx)}
                aria-current={isActive ? 'page' : undefined}
                className="group relative flex flex-col items-center justify-center gap-0.5 py-1 pb-1.5 transition-transform duration-150 active:scale-[0.94]"
              >
                <div className="relative flex h-7 w-10 items-center justify-center rounded-xl">
                  <Icon
                    aria-hidden="true"
                    className={`relative h-[19px] w-[19px] stroke-[1.7] transition-colors ${
                      isActive ? 'text-[#F5F5F7]' : 'text-[#8E8E93] group-hover:text-[#F5F5F7]'
                    }`}
                  />
                  {item.id === 'tasks' && pendingCount > 0 && (
                    <span className="font-mono-tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F5F5F7] px-1 text-[9px] font-semibold text-[#0D0D0F]">
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[11px] font-medium tracking-tight transition-colors ${
                    isActive ? 'text-[#F5F5F7]' : 'text-[#8E8E93] group-hover:text-[#F5F5F7]'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
