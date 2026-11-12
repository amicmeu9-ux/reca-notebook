import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handleApiRequest } from './server/apiRouter.mjs';

function apiDevMiddleware(env: Record<string, string>): Plugin {
  return {
    name: 'reca-api-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const handled = await handleApiRequest(req, res, { env });
          if (!handled) {
            next();
          }
        }
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, process.cwd(), '');
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    ...loaded,
  };

  return {
    plugins: [react(), tailwindcss(), apiDevMiddleware(env)],
  };
});
