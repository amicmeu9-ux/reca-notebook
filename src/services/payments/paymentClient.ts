export interface PaymentStatusResponse {
  stripeConfigured: boolean;
  webhookConfigured: boolean;
  firebaseAdminConfigured: boolean;
  mode: 'stripe' | 'demo';
}

export interface CheckoutSessionResponse {
  mode: 'stripe' | 'demo';
  sessionId?: string;
  url?: string;
}

export interface VerifyCheckoutSessionResponse {
  paid: boolean;
  packId: string;
  amount: number;
  title: string;
  cloudCredited: boolean;
  alreadyProcessed: boolean;
}

export interface RedeemReferralServerResponse {
  mode: 'server' | 'client_only';
  referralCode: string;
  amount?: number;
  inviteeCredited: boolean;
  alreadyRedeemed?: boolean;
  inviterCredited: boolean;
}

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status} en el servidor.`);
  }
  return data;
}

export async function fetchPaymentStatus(): Promise<PaymentStatusResponse> {
  return apiJson<PaymentStatusResponse>('/api/payments/status');
}

export async function createStripeCheckoutSession(params: {
  packId: string;
  uid?: string | null;
  email?: string | null;
  idToken?: string | null;
}): Promise<CheckoutSessionResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.idToken) {
    headers.Authorization = `Bearer ${params.idToken}`;
  }
  return apiJson<CheckoutSessionResponse>('/api/payments/checkout-session', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      packId: params.packId,
      uid: params.uid || undefined,
      email: params.email || undefined,
    }),
  });
}

export async function verifyStripeCheckoutSession(params: {
  sessionId: string;
  idToken?: string | null;
}): Promise<VerifyCheckoutSessionResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.idToken) {
    headers.Authorization = `Bearer ${params.idToken}`;
  }
  return apiJson<VerifyCheckoutSessionResponse>('/api/payments/verify-session', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: params.sessionId }),
  });
}

export async function redeemReferralOnServer(params: {
  referralCode: string;
  idToken?: string | null;
}): Promise<RedeemReferralServerResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.idToken) {
    headers.Authorization = `Bearer ${params.idToken}`;
  }
  return apiJson<RedeemReferralServerResponse>('/api/referrals/redeem', {
    method: 'POST',
    headers,
    body: JSON.stringify({ referralCode: params.referralCode }),
  });
}
