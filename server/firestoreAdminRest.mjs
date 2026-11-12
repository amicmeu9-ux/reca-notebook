import crypto from 'node:crypto';
import fs from 'node:fs';

let cachedToken = {
  cacheKey: '',
  accessToken: '',
  expiresAtMs: 0,
};

/** Decodifica un JSON de cuenta de servicio desde texto plano o base64 y normaliza private_key. */
export function parseServiceAccountInput(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  const tryParse = (str) => {
    try {
      const parsed = JSON.parse(str);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  if (!trimmed.startsWith('{')) {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return tryParse(decoded);
  }
  return null;
}

export function loadServiceAccount(env = process.env) {
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const parsed = parseServiceAccountInput(inline);
    if (!parsed) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no tiene un JSON de cuenta de servicio válido.');
    }
    return parsed;
  }

  const filePath = String(env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (filePath && fs.existsSync(filePath)) {
    const parsed = parseServiceAccountInput(fs.readFileSync(filePath, 'utf8'));
    if (!parsed) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH no apunta a un JSON de cuenta de servicio válido.');
    }
    return parsed;
  }

  return null;
}

export function isFirebaseAdminConfigured(env = process.env) {
  try {
    return Boolean(loadServiceAccount(env));
  } catch {
    return false;
  }
}

export function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = encodeFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function decodeFirestoreValue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if ('nullValue' in raw) return null;
  if ('booleanValue' in raw) return Boolean(raw.booleanValue);
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return Number(raw.doubleValue);
  if ('stringValue' in raw) return String(raw.stringValue);
  if ('timestampValue' in raw) return String(raw.timestampValue);
  if ('arrayValue' in raw) {
    const vals = raw.arrayValue?.values;
    return Array.isArray(vals) ? vals.map(decodeFirestoreValue) : [];
  }
  if ('mapValue' in raw) {
    return decodeFirestoreFields(raw.mapValue?.fields || {});
  }
  return null;
}

export function decodeFirestoreFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

async function getAdminAccessToken(sa) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cacheKey = `${sa.project_id}:${sa.client_email}`;
  if (cachedToken.cacheKey === cacheKey && cachedToken.accessToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  ).toString('base64url');

  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key, 'base64url');
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.access_token) {
    throw new Error(data?.error_description || 'No se pudo obtener token OAuth2 para Firebase Admin.');
  }

  cachedToken = {
    cacheKey,
    accessToken: data.access_token,
    expiresAtMs: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

export async function verifyFirebaseIdToken(idToken, env = process.env) {
  const token = String(idToken || '').trim();
  if (!token) {
    const err = new Error('Falta el token de sesión de Firebase Auth.');
    err.statusCode = 401;
    throw err;
  }

  const sa = loadServiceAccount(env);
  const webApiKey = String(env.VITE_FIREBASE_API_KEY || '').trim();

  let url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
  const headers = { 'Content-Type': 'application/json' };
  if (sa) {
    const accessToken = await getAdminAccessToken(sa);
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (webApiKey) {
    url = `${url}?key=${encodeURIComponent(webApiKey)}`;
  } else {
    throw new Error('Falta configurar Firebase (VITE_FIREBASE_API_KEY o FIREBASE_SERVICE_ACCOUNT_JSON).');
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ idToken: token }),
  });
  const data = await resp.json();
  const user = data?.users?.[0];
  if (!resp.ok || !user?.localId) {
    const err = new Error(data?.error?.message || 'Sesión de Firebase inválida o caducada.');
    err.statusCode = 401;
    throw err;
  }

  return {
    uid: String(user.localId),
    email: typeof user.email === 'string' ? user.email : null,
  };
}

function getFirestoreContext(sa, env) {
  const databaseId = String(env.VITE_FIREBASE_DATABASE_ID || '').trim() || '(default)';
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/databases/${encodeURIComponent(databaseId)}/documents`;
  const docPrefix = `projects/${sa.project_id}/databases/${databaseId}/documents`;
  return { baseUrl, docPrefix };
}

async function firestoreRequest(url, accessToken, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Error Firestore REST (${resp.status})`);
  }
  return data;
}

export async function findUserByReferralCode(referralCode, env = process.env) {
  const sa = loadServiceAccount(env);
  if (!sa) {
    throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en el servidor.');
  }
  const accessToken = await getAdminAccessToken(sa);
  const { baseUrl } = getFirestoreContext(sa, env);

  const results = await firestoreRequest(`${baseUrl}:runQuery`, accessToken, {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'referralCode' },
          op: 'EQUAL',
          value: { stringValue: referralCode },
        },
      },
      limit: 1,
    },
  });

  const doc = Array.isArray(results) ? results.find((item) => item?.document)?.document : null;
  if (!doc?.name) return null;
  const uid = doc.name.split('/').pop();
  return {
    uid,
    fields: decodeFirestoreFields(doc.fields || {}),
  };
}

/**
 * Acredita Tomas y registra una transacción inmutable de forma idempotente usando un ID determinista.
 */
export async function creditUserSparksIdempotent(params, env = process.env) {
  const { uid, amount, txId, txType, label, incrementReferralCount = false } = params;
  const sa = loadServiceAccount(env);
  if (!sa) {
    throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON para acreditar saldo en Firestore.');
  }

  const accessToken = await getAdminAccessToken(sa);
  const { baseUrl, docPrefix } = getFirestoreContext(sa, env);
  const userDocName = `${docPrefix}/users/${uid}`;
  const txDocName = `${docPrefix}/users/${uid}/transactions/${txId}`;

  const beginRes = await firestoreRequest(`${baseUrl}:beginTransaction`, accessToken, {
    options: { readWrite: {} },
  });
  const transaction = beginRes.transaction;
  let committed = false;

  try {
    const batchRes = await firestoreRequest(`${baseUrl}:batchGet`, accessToken, {
      documents: [userDocName, txDocName],
      transaction,
    });

    const foundMap = new Map();
    if (Array.isArray(batchRes)) {
      for (const entry of batchRes) {
        if (entry?.found?.name) {
          foundMap.set(entry.found.name, entry.found);
        }
      }
    }

    if (foundMap.has(txDocName)) {
      return { credited: false, alreadyProcessed: true, balance: null };
    }

    const userDoc = foundMap.get(userDocName);
    if (!userDoc) {
      throw new Error(`El perfil de usuario ${uid} todavía no existe en Firestore.`);
    }

    const currentFields = decodeFirestoreFields(userDoc.fields || {});
    const currentBalance = Number(currentFields.sparkBalance || 0);
    const currentRefCount = Number(currentFields.referralCount || 0);
    const nextBalance = currentBalance + Math.trunc(amount);
    const nextRefCount = currentRefCount + (incrementReferralCount ? 1 : 0);
    const now = new Date().toISOString();

    await firestoreRequest(`${baseUrl}:commit`, accessToken, {
      transaction,
      writes: [
        {
          update: {
            name: userDocName,
            fields: {
              sparkBalance: encodeFirestoreValue(nextBalance),
              referralCount: encodeFirestoreValue(nextRefCount),
              updatedAt: encodeFirestoreValue(now),
            },
          },
          updateMask: {
            fieldPaths: ['sparkBalance', 'referralCount', 'updatedAt'],
          },
          currentDocument: {
            updateTime: userDoc.updateTime,
          },
        },
        {
          update: {
            name: txDocName,
            fields: {
              uid: encodeFirestoreValue(uid),
              type: encodeFirestoreValue(txType),
              amount: encodeFirestoreValue(Math.trunc(amount)),
              label: encodeFirestoreValue(String(label).slice(0, 200)),
              createdAt: encodeFirestoreValue(now),
            },
          },
          currentDocument: { exists: false },
        },
      ],
    });

    committed = true;
    return { credited: true, alreadyProcessed: false, balance: nextBalance };
  } finally {
    if (!committed && transaction) {
      await firestoreRequest(`${baseUrl}:rollback`, accessToken, { transaction }).catch(() => {});
    }
  }
}
