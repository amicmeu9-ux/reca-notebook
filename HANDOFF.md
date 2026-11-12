# HANDOFF — Reca (`notebook`)

Guía rápida para continuar el desarrollo o despliegue de **Reca** en otro editor o con otra IA sin perder contexto ni filtrar claves privadas.

## ⚠️ Regla de seguridad antes de compartir
**NO subas ni pegues el archivo `.env` real.** Contiene claves secretas (`GEMINI_API_KEY`, y en producción `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`).
- Para pasarle el código a otra IA o subirlo a GitHub, comparte `.env.example` y excluye `.env`, `node_modules/`, `dist/` y `.firebase/`.
- `.gitignore` y `.dockerignore` ya excluyen `.env`, `node_modules/` y `dist/`.

## Stack y estructura
- **Frontend:** React 19 + TypeScript + Vite 6 + Tailwind CSS v4 (`npm run dev`, `npm run build`).
- **Backend Node unificado (sin dependencias extra):** `server/index.mjs` + `server/apiRouter.mjs` (sirve también dentro del middleware de Vite en `vite.config.ts`).
- **IA (Gemini):** `server/geminiHandler.mjs` con fallback automático entre modelos Flash (`gemini-3.8-flash` → `gemini-3-flash-preview` → `gemini-3.1-flash-lite`) y timeout por petición.
- **Firebase + Firestore:**
  - Cliente: `src/services/firebase/config.ts`, `src/services/firebase/authService.ts` (`getFirebaseIdToken`). Funciona en modo local si `VITE_FIREBASE_*` está vacío.
  - Servidor REST (sin SDK pesado): `server/firestoreAdminRest.mjs` (verificación JWT/Identity Toolkit + transacciones atómicas idempotentes por REST).
  - Reglas: `firestore.rules` (modo prototipo actual) y `firestore.production.rules` (bloquea mutaciones de saldo/transacciones desde el cliente cuando Stripe + Admin REST estén activos en servidor).
- **Pagos (Stripe) y Referidos cruzados:**
  - Catálogo compartido: `src/config/packs.json` y `src/config/brand.ts`.
  - Backend: `server/paymentsHandler.mjs` (Checkout Session, verificación HMAC-SHA256 de webhooks y acreditación idempotente de referidos cruzados).
  - Frontend: `src/services/payments/paymentClient.ts`, `src/hooks/useNotebookStore.ts`, `src/components/views/WalletView.tsx`.
  - Si `STRIPE_SECRET_KEY` está vacío, la app opera en modo `demo` local sin romperse.
- **Despliegue HTTPS:** `Dockerfile`, `.dockerignore`, `render.yaml`, `railway.json`, `firebase.json`.

## Endpoints `/api/*`
- `GET /api/health` → estado del servidor y banderas de configuración (`geminiConfigured`, `stripeConfigured`, `webhookConfigured`, `firebaseAdminConfigured`).
- `GET /api/ai/status` → estado de Gemini.
- `POST /api/ai/quick-voice`, `POST /api/ai/brain-dump`, `POST /api/ai/scan-image` → endpoints de Gemini con rate limit en memoria.
- `GET /api/payments/status` → modo (`stripe` | `demo`) y packs disponibles.
- `POST /api/payments/checkout-session` → crea Stripe Checkout Session (o devuelve `mode: "demo"` si falta `STRIPE_SECRET_KEY`).
- `POST /api/payments/verify-session` → verifica sesión Stripe al volver del checkout y acredita en Firestore si aplica.
- `POST /api/payments/webhook` → valida cabecera `Stripe-Signature` (HMAC-SHA256) y procesa `checkout.session.completed`.
- `POST /api/referrals/redeem` → canjea código de referido cruzado acreditando invitado + invitador.

## Comandos principales
```bash
npm install
npm run dev       # Vite + middleware /api/* en http://localhost:5173
npm test          # Vitest (tests/core.test.ts)
npm run build     # tsc -b && vite build -> dist/
npm run start     # Servidor de producción Node (sirve dist/ + /api/*, puerto 8787 por defecto)
```

## Variables de entorno (`.env.example`)
- `GEMINI_API_KEY`: clave de Google AI Studio (solo servidor).
- `VITE_FIREBASE_*`: configuración pública web de tu proyecto Firebase (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`, opcional `DATABASE_ID`).
- `PUBLIC_APP_URL`: URL pública HTTPS en producción (por ejemplo `https://tu-app.up.railway.app`).
- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON de cuenta de servicio Firebase Admin (en texto o Base64) para acreditar referidos y compras en Firestore desde servidor.
- `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`: claves de Stripe para cobros reales y webhook `/api/payments/webhook`.

## Lo que falta por conectar (requiere cuentas del usuario)
1. Subir el repo a **Railway** o **Render** usando `railway.json`, `render.yaml` o `Dockerfile` y configurar las variables de entorno.
2. En **Firebase Console**: crear/seleccionar proyecto, activar Auth + Firestore, copiar `VITE_FIREBASE_*` y la cuenta de servicio (`FIREBASE_SERVICE_ACCOUNT_JSON`); cuando todo esté activo en servidor, cambiar `firebase.json` a `firestore.production.rules` y ejecutar `firebase deploy --only firestore:rules`.
3. En **Stripe Dashboard**: añadir `STRIPE_SECRET_KEY` y crear webhook apuntando a `<PUBLIC_APP_URL>/api/payments/webhook` para `checkout.session.completed` (`STRIPE_WEBHOOK_SECRET`).
