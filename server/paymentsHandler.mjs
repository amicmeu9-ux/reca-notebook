import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  creditUserSparksIdempotent,
  findUserByReferralCode,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firestoreAdminRest.mjs';

const packsConfig = JSON.parse(
  fs.readFileSync(new URL('../src/config/packs.json', import.meta.url), 'utf8')
);

export const PACKS = packsConfig.packs;
export const REFERRAL_BONUS = Number(packsConfig.referralBonus || 30);
const REFERRAL_CODE_RE = /^(NB|RC)-[A-Z0-9]{2,24}$/;

function sanitizeTxSegment(raw) {
  return String(raw || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
}

function getSafeOrigin(originHeader, env = process.env) {
  const configured = String(env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured;
  }
  const candidate = String(originHeader || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[A-Za-z0-9._:-]+$/i.test(candidate)) {
    return candidate;
  }
  return 'http://localhost:5173';
}

export function getPaymentsStatus(env = process.env) {
  const stripeConfigured = Boolean(String(env.STRIPE_SECRET_KEY || '').trim());
  const webhookConfigured = Boolean(String(env.STRIPE_WEBHOOK_SECRET || '').trim());
  return {
    stripeConfigured,
    webhookConfigured,
    firebaseAdminConfigured: isFirebaseAdminConfigured(env),
    mode: stripeConfigured ? 'stripe' : 'demo',
    packs: PACKS,
  };
}

/**
 * Verifica el encabezado `Stripe-Signature` (`t=...,v1=...`) con tolerancia anti-replay de 5 minutos.
 */
export function verifyStripeSignature({
  rawBody,
  signatureHeader,
  webhookSecret,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const secret = String(webhookSecret || '').trim();
  const header = String(signatureHeader || '').trim();
  if (!secret || !header) return false;

  const parts = header.split(',').map((item) => item.trim());
  let timestamp = '';
  const v1Signatures = [];
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === 't' && !timestamp) timestamp = val;
    if (key === 'v1' && val) v1Signatures.push(val);
  }

  const tsNum = Number(timestamp);
  if (!timestamp || !Number.isFinite(tsNum) || v1Signatures.length === 0) {
    return false;
  }
  if (Math.abs(nowSeconds - tsNum) > toleranceSeconds) {
    return false;
  }

  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadStr}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  for (const sigHex of v1Signatures) {
    if (!/^[0-9a-f]+$/i.test(sigHex)) continue;
    const sigBuf = Buffer.from(sigHex, 'hex');
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export async function handleCreateCheckoutSession(payload, env = process.env) {
  const pack = PACKS.find((p) => p.id === payload?.packId);
  if (!pack) {
    const err = new Error('Paquete de recarga no válido.');
    err.statusCode = 400;
    throw err;
  }

  const stripeSecretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!stripeSecretKey) {
    return {
      mode: 'demo',
      pack,
    };
  }

  const firebaseActiveOnServer =
    isFirebaseAdminConfigured(env) || Boolean(String(env.VITE_FIREBASE_API_KEY || '').trim());

  let uid = String(payload?.uid || 'local-student').trim() || 'local-student';
  let customerEmail = typeof payload?.email === 'string' ? payload.email.trim() : '';

  if (firebaseActiveOnServer && payload?.idToken) {
    const verified = await verifyFirebaseIdToken(payload.idToken, env);
    uid = verified.uid;
    if (verified.email) customerEmail = verified.email;
  } else if (isFirebaseAdminConfigured(env)) {
    const err = new Error('Inicia sesión en Firebase para completar la recarga con Stripe.');
    err.statusCode = 401;
    throw err;
  }

  const origin = getSafeOrigin(payload?.origin, env);
  const form = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(pack.priceCents),
    'line_items[0][price_data][product_data][name]': `Reca — ${pack.title} (${pack.amount} Tomas)`,
    'line_items[0][price_data][product_data][description]': pack.subtitle,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    client_reference_id: uid,
    'metadata[uid]': uid,
    'metadata[packId]': pack.id,
    'metadata[sparks]': String(pack.amount),
  });
  if (customerEmail) {
    form.set('customer_email', customerEmail);
  }

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.url || !data?.id) {
    throw new Error(data?.error?.message || 'Stripe no pudo crear la sesión de pago.');
  }

  return {
    mode: 'stripe',
    sessionId: data.id,
    url: data.url,
  };
}

async function applyPaidCheckoutSession(session, callerUid, env) {
  if (!session || session.payment_status !== 'paid') {
    const err = new Error('El pago todavía no figura como completado en Stripe.');
    err.statusCode = 402;
    throw err;
  }

  const packId = String(session.metadata?.packId || '');
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) {
    const err = new Error('Paquete asociado al pago no reconocido.');
    err.statusCode = 400;
    throw err;
  }

  const targetUid = String(session.metadata?.uid || session.client_reference_id || '').trim();
  if (callerUid && targetUid && targetUid !== callerUid) {
    const err = new Error('Esta sesión de pago pertenece a otra cuenta.');
    err.statusCode = 403;
    throw err;
  }

  let cloudCredited = false;
  let alreadyProcessed = false;
  if (targetUid && targetUid !== 'local-student' && isFirebaseAdminConfigured(env)) {
    const res = await creditUserSparksIdempotent(
      {
        uid: targetUid,
        amount: pack.amount,
        txId: `stripe_${sanitizeTxSegment(session.id)}`,
        txType: 'pack_purchase',
        label: `Recarga Stripe · ${pack.title} (${pack.priceLabel})`,
        incrementReferralCount: false,
      },
      env
    );
    cloudCredited = res.credited;
    alreadyProcessed = res.alreadyProcessed;
  }

  return {
    paid: true,
    packId: pack.id,
    amount: pack.amount,
    title: pack.title,
    cloudCredited,
    alreadyProcessed,
  };
}

export async function handleVerifyCheckoutSession(payload, env = process.env) {
  const sessionId = String(payload?.sessionId || '').trim();
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    const err = new Error('Identificador de sesión de Stripe inválido.');
    err.statusCode = 400;
    throw err;
  }

  const stripeSecretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!stripeSecretKey) {
    const err = new Error('STRIPE_SECRET_KEY no está configurada en el servidor.');
    err.statusCode = 503;
    throw err;
  }

  let callerUid = null;
  if (payload?.idToken && (isFirebaseAdminConfigured(env) || env.VITE_FIREBASE_API_KEY)) {
    const verified = await verifyFirebaseIdToken(payload.idToken, env);
    callerUid = verified.uid;
  }

  const resp = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
      },
    }
  );
  const session = await resp.json();
  if (!resp.ok) {
    throw new Error(session?.error?.message || 'No se pudo verificar la sesión en Stripe.');
  }

  return applyPaidCheckoutSession(session, callerUid, env);
}

export async function handleStripeWebhook({ rawBody, signatureHeader }, env = process.env) {
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    const err = new Error('STRIPE_WEBHOOK_SECRET no configurada en el servidor.');
    err.statusCode = 503;
    throw err;
  }

  const valid = verifyStripeSignature({
    rawBody,
    signatureHeader,
    webhookSecret,
  });
  if (!valid) {
    const err = new Error('Firma Stripe-Signature inválida.');
    err.statusCode = 400;
    throw err;
  }

  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  if (event?.type === 'checkout.session.completed' && event?.data?.object?.payment_status === 'paid') {
    const result = await applyPaidCheckoutSession(event.data.object, null, env);
    return { received: true, handled: true, ...result };
  }

  return { received: true, handled: false, type: event?.type || 'unknown' };
}

export async function handleRedeemReferral(payload, env = process.env) {
  const code = String(payload?.referralCode || '').trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(code)) {
    const err = new Error('Código de invitación inválido.');
    err.statusCode = 400;
    throw err;
  }

  if (!isFirebaseAdminConfigured(env)) {
    return {
      mode: 'client_only',
      referralCode: code,
      inviteeCredited: false,
      inviterCredited: false,
    };
  }

  const verified = await verifyFirebaseIdToken(payload?.idToken, env);
  const inviter = await findUserByReferralCode(code, env);
  if (!inviter) {
    const err = new Error(`El código de invitación ${code} no existe.`);
    err.statusCode = 404;
    throw err;
  }
  if (inviter.uid === verified.uid) {
    const err = new Error(`No puedes canjear tu propio código ${code}.`);
    err.statusCode = 400;
    throw err;
  }

  const inviteeTxId = `ref_welcome_${sanitizeTxSegment(verified.uid)}`;
  const inviteeRes = await creditUserSparksIdempotent(
    {
      uid: verified.uid,
      amount: REFERRAL_BONUS,
      txId: inviteeTxId,
      txType: 'referral',
      label: `Invitación canjeada (${code})`,
      incrementReferralCount: false,
    },
    env
  );

  let inviterCredited = false;
  if (inviteeRes.credited) {
    const inviterRes = await creditUserSparksIdempotent(
      {
        uid: inviter.uid,
        amount: REFERRAL_BONUS,
        txId: `ref_from_${sanitizeTxSegment(verified.uid)}`,
        txType: 'referral',
        label: 'Amigo unido con tu código',
        incrementReferralCount: true,
      },
      env
    );
    inviterCredited = inviterRes.credited;
  }

  return {
    mode: 'server',
    referralCode: code,
    amount: REFERRAL_BONUS,
    inviteeCredited: inviteeRes.credited,
    alreadyRedeemed: inviteeRes.alreadyProcessed,
    inviterCredited,
  };
}
