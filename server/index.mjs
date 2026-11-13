import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleApiRequest, sendJson } from './apiRouter.mjs';

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function tryServeStatic(reqUrl, method, res) {
  if (!fs.existsSync(DIST_DIR)) return false;

  const pathname = new URL(reqUrl || '/', 'http://localhost').pathname;
  const normalizedPath = pathname === '/showcase' ? '/showcase.html' : pathname;
  const relPath = normalizedPath === '/' ? 'index.html' : normalizedPath.replace(/^\/+/, '');
  let targetPath = path.resolve(DIST_DIR, relPath);
  const relCheck = path.relative(DIST_DIR, targetPath);

  if (relCheck === '..' || relCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relCheck)) {
    return false;
  }

  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    const fallbackIndex = path.join(DIST_DIR, 'index.html');
    if (!fs.existsSync(fallbackIndex)) return false;
    targetPath = fallbackIndex;
  }

  const ext = path.extname(targetPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(targetPath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  const handled = await handleApiRequest(req, res, { env: process.env });
  if (handled) return;

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (tryServeStatic(req.url, req.method, res)) return;
  }
  sendJson(res, 404, { error: 'Ruta no encontrada (ejecuta npm run build para servir dist).' });
});

server.listen(PORT, () => {
  console.log(`Reca API server escuchando en http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
