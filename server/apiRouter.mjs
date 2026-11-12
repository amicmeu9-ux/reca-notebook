import {
  handleBrainDumpRequest,
  handleQuickVoiceRequest,
  handleScanImageRequest,
} from './geminiHandler.mjs';
import { isFirebaseAdminConfigured } from './firestoreAdminRest.mjs';
import {
  getPaymentsStatus,
  handleCreateCheckoutSession,
  handleRedeemReferral,
  handleStripeWebhook,
  handleVerifyCheckoutSession,
} from './paymentsHandler.mjs';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const aiRateBuckets = new Map();

function checkAiRateLimit(ip) {
  const now = Date.now();
  const prev = aiRateBuckets.get(ip) || [];
  const active = prev.filter((ts) => now - ts < RATE_WINDOW_MS);
  if (active.length >= RATE_MAX_REQUESTS) {
    aiRateBuckets.set(ip, active);
    return false;
  }
  active.push(now);
  aiRateBuckets.set(ip, active);
  return true;
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readRawBody(req, maxBytes = 22 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('El archivo enviado supera el límite de 20 MB.'));
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = (await readRawBody(req)).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('JSON inválido en el cuerpo de la petición.');
    err.statusCode = 400;
    throw err;
  }
}

function extractBearerToken(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return '';
}

function resolveRequestOrigin(req, env) {
  const configured = String(env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto =
    String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() ||
    (req.socket?.encrypted ? 'https' : 'http');
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '')
    .split(',')[0]
    .trim();
  return host ? `${proto}://${host}` : 'http://localhost:5173';
}

function getClientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'local')
    .split(',')[0]
    .trim();
}

/**
 * Enrutador unificado `/api/*` compartido entre el servidor Node de producción y el middleware de Vite.
 */
export async function handleApiRequest(req, res, options = {}) {
  const env = options.env || process.env;
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  if (!pathname.startsWith('/api/')) {
    return false;
  }

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      const paymentStatus = getPaymentsStatus(env);
      sendJson(res, 200, {
        ok: true,
        service: 'reca',
        geminiConfigured: Boolean(String(env.GEMINI_API_KEY || '').trim()),
        stripeConfigured: paymentStatus.stripeConfigured,
        webhookConfigured: paymentStatus.webhookConfigured,
        firebaseAdminConfigured: isFirebaseAdminConfigured(env),
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/ai/status') {
      sendJson(res, 200, {
        geminiConfigured: Boolean(String(env.GEMINI_API_KEY || '').trim()),
        model: 'gemini-3.8-flash',
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/payments/status') {
      sendJson(res, 200, getPaymentsStatus(env));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/payments/webhook') {
      const rawBody = await readRawBody(req, 2 * 1024 * 1024);
      const signatureHeader = String(req.headers?.['stripe-signature'] || '');
      const result = await handleStripeWebhook({ rawBody, signatureHeader }, env);
      sendJson(res, 200, result);
      return true;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Método no permitido' });
      return true;
    }

    if (pathname.startsWith('/api/ai/')) {
      if (!checkAiRateLimit(getClientIp(req))) {
        sendJson(res, 429, {
          code: 'RATE_LIMIT',
          error: 'Demasiadas peticiones de IA en poco tiempo. Espera unos segundos.',
        });
        return true;
      }

      const body = await readJsonBody(req);
      const headerKey = req.headers?.['x-gemini-key'];
      const apiKeyOverride =
        typeof headerKey === 'string' && headerKey.trim() ? headerKey.trim() : undefined;
      const payload = { ...body, apiKeyOverride };
      const serverKey = String(env.GEMINI_API_KEY || '').trim();

      let result;
      if (pathname === '/api/ai/quick-voice') {
        result = await handleQuickVoiceRequest(payload, serverKey);
      } else if (pathname === '/api/ai/brain-dump') {
        result = await handleBrainDumpRequest(payload, serverKey);
      } else if (pathname === '/api/ai/scan-image') {
        result = await handleScanImageRequest(payload, serverKey);
      } else {
        sendJson(res, 404, { error: 'Endpoint de IA desconocido' });
        return true;
      }

      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/payments/checkout-session') {
      const body = await readJsonBody(req);
      const result = await handleCreateCheckoutSession(
        {
          ...body,
          idToken: extractBearerToken(req),
          origin: resolveRequestOrigin(req, env),
        },
        env
      );
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/payments/verify-session') {
      const body = await readJsonBody(req);
      const result = await handleVerifyCheckoutSession(
        {
          ...body,
          idToken: extractBearerToken(req),
        },
        env
      );
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/referrals/redeem') {
      const body = await readJsonBody(req);
      const result = await handleRedeemReferral(
        {
          ...body,
          idToken: extractBearerToken(req),
        },
        env
      );
      sendJson(res, 200, result);
      return true;
    }

    sendJson(res, 404, { error: 'Ruta de API no encontrada' });
    return true;
  } catch (err) {
    const statusCode = Number(err?.statusCode) || (err?.code === 'NO_API_KEY' ? 400 : 500);
    sendJson(res, statusCode, {
      code: err?.code || 'API_ERROR',
      error: err instanceof Error ? err.message : 'Error procesando la petición en el servidor.',
    });
    return true;
  }
}
