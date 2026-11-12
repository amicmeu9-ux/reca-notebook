import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Gift,
  Share2,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { BRAND_CONFIG } from '../../config/brand';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { getFirebaseIdToken } from '../../services/firebase/authService';
import {
  createStripeCheckoutSession,
  fetchPaymentStatus,
} from '../../services/payments/paymentClient';
import type { AppUserProfile, WalletState } from '../../types/notebook';
import { formatRelativeTimeShort, getDailyCooldownStatus } from '../../utils/dateUtils';
import { SparkAmount } from '../common/SparkAmount';

interface WalletViewProps {
  user: AppUserProfile | null;
  wallet: WalletState;
  onClaimDaily: () => Promise<number>;
  onPurchasePack: (packId: string) => Promise<number>;
  onCreditReferralDemo: () => Promise<number>;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function WalletView({
  user,
  wallet,
  onClaimDaily,
  onPurchasePack,
  onCreditReferralDemo,
  onNotify,
}: WalletViewProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [stripeConfigured, setStripeConfigured] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPaymentStatus()
      .then((res) => {
        if (active) setStripeConfigured(res.stripeConfigured);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const cooldown = getDailyCooldownStatus(wallet.lastDailyClaimAt, nowMs);
  const selectedPack = BRAND_CONFIG.packs.find((p) => p.id === selectedPackId) || null;
  const { handleBackdropClick: handlePackBackdropClick } = useModalDismiss(
    Boolean(selectedPack),
    () => setSelectedPackId(null)
  );

  const handleClaim = async () => {
    if (!cooldown.canClaim || claiming) return;
    setClaiming(true);
    try {
      await onClaimDaily();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No se pudo reclamar.', 'warning');
    } finally {
      setClaiming(false);
    }
  };

  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${wallet.referralCode}`;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      onNotify('Enlace de invitación copiado.', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify(`Tu código es ${wallet.referralCode}`, 'info');
    }
  };

  const handleShareInvite = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: BRAND_CONFIG.appName,
          text: `Usa mi código ${wallet.referralCode} en ${BRAND_CONFIG.appName} y consigue tomas gratis para tus apuntes y exámenes.`,
          url: inviteUrl,
        });
        return;
      } catch {
        // fallback a copiar
      }
    }
    await handleCopyInvite();
  };

  const handleConfirmPurchase = async () => {
    if (!selectedPack || purchasing) return;
    setPurchasing(true);
    try {
      const idToken = user?.provider === 'firebase' ? await getFirebaseIdToken() : null;
      const checkout = await createStripeCheckoutSession({
        packId: selectedPack.id,
        uid: user?.uid,
        email: user?.email,
        idToken,
      });
      if (checkout.mode === 'stripe' && checkout.url) {
        window.location.assign(checkout.url);
        return;
      }
      await onPurchasePack(selectedPack.id);
      setSelectedPackId(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error al recargar.', 'error');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="space-y-6 px-5 pb-28 pt-4">
      <div>
        <h1 className="font-display text-[26px] font-medium leading-tight tracking-[-0.025em] text-[#F5F5F7]">
          Cartera y Tienda
        </h1>
        <p className="mt-1 text-[13px] font-normal text-[#8E8E93]">
          Gestiona tus tomas para vaciados mentales y escáneres de pizarra.
        </p>
      </div>

      {/* Tarjeta principal de saldo */}
      <div className="nb-card rounded-2xl p-5">
        <div>
          <span className="text-xs font-normal text-[#8E8E93]">Saldo disponible</span>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <SparkAmount
              value={wallet.balance}
              tone="accent"
              className="font-display text-4xl font-medium text-[#F5F5F7]"
              iconClassName="h-7 w-7"
            />
            <span className="text-xs font-normal text-[#8E8E93]">
              {BRAND_CONFIG.currency.namePlural}
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5 text-center text-[11px]">
          <div className="rounded-xl border border-[#242428] bg-[#1E1E22] px-2 py-2.5">
            <div className="flex justify-center">
              <SparkAmount
                value={BRAND_CONFIG.costs.quickVoice}
                className="font-medium text-[#F5F5F7]"
                iconClassName="h-3 w-3"
              />
            </div>
            <p className="mt-1 font-normal text-[#8E8E93]">Nota rápida</p>
          </div>
          <div className="rounded-xl border border-[#242428] bg-[#1E1E22] px-2 py-2.5">
            <div className="flex justify-center">
              <SparkAmount
                value={BRAND_CONFIG.costs.brainDump}
                className="font-medium text-[#F5F5F7]"
                iconClassName="h-3 w-3"
              />
            </div>
            <p className="mt-1 font-normal text-[#8E8E93]">Vaciado</p>
          </div>
          <div className="rounded-xl border border-[#242428] bg-[#1E1E22] px-2 py-2.5">
            <div className="flex justify-center">
              <SparkAmount
                value={BRAND_CONFIG.costs.scanner}
                className="font-medium text-[#F5F5F7]"
                iconClassName="h-3 w-3"
              />
            </div>
            <p className="mt-1 font-normal text-[#8E8E93]">Escáner</p>
          </div>
        </div>
      </div>

      {/* Bono diario +10 ⚡ */}
      <div className="nb-card flex items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]">
            <Gift className="h-4.5 w-4.5 stroke-[1.7]" aria-hidden="true" />
          </div>
          <div>
            <p className="font-display inline-flex items-center gap-1.5 text-sm font-medium text-[#F5F5F7]">
              <SparkAmount
                prefix="+"
                value={BRAND_CONFIG.currency.dailyBonus}
                iconClassName="h-3.5 w-3.5"
              />
              <span>diarios gratis</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs font-normal text-[#8E8E93]">
              <Clock className="h-3 w-3 stroke-[1.7]" aria-hidden="true" />
              <span className="font-mono-tabular">
                {cooldown.canClaim ? 'Listos para reclamar' : `Siguiente en ${cooldown.label}`}
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClaim}
          disabled={!cooldown.canClaim || claiming}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-medium transition active:scale-95 ${
            cooldown.canClaim
              ? 'bg-[#F5F5F7] text-[#0D0D0F] hover:bg-white'
              : 'cursor-not-allowed border border-[#242428] bg-[#1E1E22] text-[#8E8E93]'
          }`}
        >
          {cooldown.canClaim ? 'Reclamar' : 'Reclamado'}
        </button>
      </div>

      {/* Invitar amigos */}
      <div className="nb-card space-y-3.5 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]">
              <Users className="h-4.5 w-4.5 stroke-[1.7]" aria-hidden="true" />
            </div>
            <div>
              <p className="font-display text-sm font-medium text-[#F5F5F7]">Invita a tus amigos</p>
              <p className="mt-0.5 text-xs font-normal text-[#8E8E93]">
                Gana{' '}
                <SparkAmount
                  prefix="+"
                  value={BRAND_CONFIG.currency.referralBonus}
                  className="font-medium text-[#F5F5F7]"
                  iconClassName="h-3 w-3"
                />{' '}
                por cada compañero que entre con tu código.
              </p>
            </div>
          </div>
          <span className="font-mono-tabular shrink-0 rounded-full border border-[#242428] bg-[#1E1E22] px-2.5 py-1 text-[11px] font-normal text-[#8E8E93]">
            {wallet.referralCount} inv.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="font-mono-tabular flex-1 truncate rounded-xl border border-[#242428] bg-[#1E1E22] px-3 py-2 text-xs font-medium text-[#F5F5F7]">
            {wallet.referralCode}
          </div>
          <button
            type="button"
            onClick={handleCopyInvite}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#242428] bg-[#1E1E22] px-3 py-2 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
          >
            {copied ? <Check className="h-3.5 w-3.5 stroke-[1.8] text-[#F5F5F7]" /> : <Copy className="h-3.5 w-3.5 stroke-[1.7]" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={handleShareInvite}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F5F5F7] px-3 py-2 text-xs font-medium text-[#0D0D0F] transition hover:bg-white"
          >
            <Share2 className="h-3.5 w-3.5 stroke-[1.8]" aria-hidden="true" />
            Invitar
          </button>
        </div>

        <button
          type="button"
          onClick={() => void onCreditReferralDemo()}
          className="inline-flex items-center gap-1 text-[11px] font-normal text-[#8E8E93] underline decoration-[#2E2E34] underline-offset-4 transition hover:text-[#F5F5F7]"
        >
          <span>Simular amigo registrado (</span>
          <SparkAmount
            prefix="+"
            value={BRAND_CONFIG.currency.referralBonus}
            iconClassName="h-2.5 w-2.5"
          />
          <span>demo)</span>
        </button>
      </div>

      {/* Paquetes de recarga */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 px-0.5">
          <ShoppingBag className="h-4 w-4 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
          <h2 className="text-[13px] font-medium text-[#8E8E93]">Paquetes de recarga</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {BRAND_CONFIG.packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => setSelectedPackId(pack.id)}
              className="nb-card nb-card-interactive relative flex flex-col items-start rounded-2xl p-4 text-left"
            >
              <span
                className={`mb-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                  pack.highlight
                    ? 'bg-[#F5F5F7] text-[#0D0D0F]'
                    : 'border border-[#242428] bg-[#1E1E22] text-[#8E8E93]'
                }`}
              >
                {pack.badge}
              </span>
              <SparkAmount
                value={pack.amount}
                className="font-display text-xl font-medium text-[#F5F5F7]"
                iconClassName="h-4 w-4"
              />
              <span className="mt-1 text-xs font-medium text-[#F5F5F7]">{pack.title}</span>
              <span className="mt-0.5 text-[11px] font-normal leading-snug text-[#8E8E93]">
                {pack.subtitle}
              </span>

              <span
                className={`font-mono-tabular mt-4 inline-flex w-full items-center justify-center rounded-xl py-2 text-xs font-medium ${
                  pack.highlight
                    ? 'bg-[#F5F5F7] text-[#0D0D0F]'
                    : 'border border-[#242428] bg-[#1E1E22] text-[#F5F5F7]'
                }`}
              >
                {pack.priceLabel}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Historial de movimientos */}
      <section className="space-y-3">
        <h2 className="px-0.5 text-[13px] font-medium text-[#8E8E93]">Actividad reciente</h2>
        <div className="nb-card divide-y divide-[#242428] rounded-2xl">
          {wallet.transactions.slice(0, 8).map((tx) => {
            const positive = tx.amount >= 0;
            return (
              <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#242428] bg-[#1E1E22] ${
                      positive ? 'text-[#F5F5F7]' : 'text-[#8E8E93]'
                    }`}
                  >
                    {positive ? (
                      <ArrowDownLeft className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[#F5F5F7]">{tx.label}</p>
                    <p className="text-[11px] font-normal text-[#8E8E93]">
                      {formatRelativeTimeShort(tx.createdAt)}
                    </p>
                  </div>
                </div>
                <SparkAmount
                  value={Math.abs(tx.amount)}
                  prefix={positive ? '+' : '-'}
                  className={`shrink-0 text-xs font-medium ${
                    positive ? 'text-[#F5F5F7]' : 'text-[#8E8E93]'
                  }`}
                  iconClassName="h-3 w-3"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Modal confirmación paquete */}
      {selectedPack && (
        <div
          onClick={handlePackBackdropClick}
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0D0D0F]/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar recarga"
            className="nb-card w-full max-w-md rounded-t-3xl p-5 sm:rounded-3xl"
          >
            <h3 className="font-display text-lg font-medium text-[#F5F5F7]">Confirmar recarga</h3>
            <p className="mt-1.5 text-xs font-normal leading-relaxed text-[#8E8E93]">
              Vas a añadir{' '}
              <SparkAmount
                value={selectedPack.amount}
                className="font-medium text-[#F5F5F7]"
                iconClassName="h-3 w-3"
              />{' '}
              ({selectedPack.title}) por{' '}
              <span className="font-medium text-[#F5F5F7]">{selectedPack.priceLabel}</span>.
            </p>
            <div className="mt-3 rounded-xl border border-[#242428] bg-[#1E1E22] p-3 text-[11px] font-normal text-[#8E8E93]">
              {stripeConfigured
                ? 'Pago seguro con Stripe Checkout (EUR). Tus tomas se acreditan automáticamente al completar el pago.'
                : 'Pasarela conectada a Stripe / webhooks. Sin STRIPE_SECRET_KEY en .env puedes acreditar esta recarga en modo prueba.'}
            </div>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedPackId(null)}
                className="flex-1 rounded-xl border border-[#242428] bg-[#1E1E22] py-2.5 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmPurchase}
                disabled={purchasing}
                className="flex-1 rounded-xl bg-[#F5F5F7] py-2.5 text-xs font-medium text-[#0D0D0F] transition hover:bg-white disabled:opacity-45"
              >
                {purchasing
                  ? 'Procesando...'
                  : stripeConfigured
                    ? `Pagar con Stripe (${selectedPack.priceLabel})`
                    : `Acreditar (${selectedPack.priceLabel})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
