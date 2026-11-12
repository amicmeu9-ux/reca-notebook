import { Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BRAND_CONFIG } from '../../config/brand';
import type { AppUserProfile } from '../../types/notebook';
import { SparkAmount } from '../common/SparkAmount';

interface TopHeaderProps {
  balance: number;
  user: AppUserProfile | null;
  firebaseReady: boolean;
  geminiReady: boolean;
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

export function TopHeader({
  balance,
  onOpenWallet,
  onOpenSettings,
}: TopHeaderProps) {
  const [pop, setPop] = useState(false);
  const prevBalanceRef = useRef(balance);

  useEffect(() => {
    if (prevBalanceRef.current !== balance) {
      prevBalanceRef.current = balance;
      setPop(true);
      const t = window.setTimeout(() => setPop(false), 320);
      return () => window.clearTimeout(t);
    }
  }, [balance]);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-[#0D0D0F]/78 px-5 py-3.5 backdrop-blur-2xl">
      <span className="font-display text-[19px] font-medium text-[#F5F5F7]">
        {BRAND_CONFIG.appName}
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Abrir ajustes"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[#8E8E93] transition hover:border-[#242428] hover:bg-[#161618] hover:text-[#F5F5F7] active:scale-95"
        >
          <Settings2 className="h-4 w-4 stroke-[1.7]" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onOpenWallet}
          aria-label={`Saldo disponible: ${balance.toLocaleString('es-ES')} ${BRAND_CONFIG.currency.namePlural}`}
          className={`inline-flex h-9 items-center rounded-full border border-[#242428] bg-[#161618] px-3.5 text-[13px] font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#1C1C1F] active:scale-95 ${
            pop ? 'animate-nb-pop' : ''
          }`}
        >
          <SparkAmount value={balance} tone="accent" />
        </button>
      </div>
    </header>
  );
}
