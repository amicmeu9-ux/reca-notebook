const REFERRAL_CODE_RE = /^(NB|RC)-[A-Z0-9]{2,24}$/;

/** Normaliza y valida códigos de invitación emitidos por Reca (`RC-...` o legado `NB-...`). */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const candidate = String(raw || '').trim().toUpperCase();
  return REFERRAL_CODE_RE.test(candidate) ? candidate : null;
}

/** Determina si un código de invitación guardado puede canjearse sin autoinvitarse ni duplicarse. */
export function canRedeemPendingReferral(params: {
  pendingCode: string | null | undefined;
  ownReferralCode: string | null | undefined;
  alreadyRedeemedCode: string | null | undefined;
}): { eligible: boolean; code: string | null; reason?: 'invalid' | 'self' | 'already_redeemed' } {
  const normalized = normalizeReferralCode(params.pendingCode);
  if (!normalized) {
    return { eligible: false, code: null, reason: 'invalid' };
  }

  const redeemed = normalizeReferralCode(params.alreadyRedeemedCode);
  if (redeemed) {
    return { eligible: false, code: normalized, reason: 'already_redeemed' };
  }

  const own = normalizeReferralCode(params.ownReferralCode);
  if (own && own === normalized) {
    return { eligible: false, code: normalized, reason: 'self' };
  }

  return { eligible: true, code: normalized };
}
