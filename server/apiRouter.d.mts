import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void;

export function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options?: { env?: Record<string, string | undefined> }
): Promise<boolean>;
