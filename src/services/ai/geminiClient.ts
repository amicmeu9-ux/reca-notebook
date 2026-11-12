import type { AiExtractionResponse } from '../../types/notebook';
import { getTodayISO } from '../../utils/dateUtils';

const SESSION_KEY_STORAGE = 'notebook_dev_gemini_key';

export function getSessionGeminiKey(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setSessionGeminiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) {
      sessionStorage.setItem(SESSION_KEY_STORAGE, trimmed);
    } else {
      sessionStorage.removeItem(SESSION_KEY_STORAGE);
    }
  } catch {
    // ignore
  }
}

export interface AiServerStatus {
  geminiConfigured: boolean;
  model: string;
}

export async function fetchAiStatus(): Promise<AiServerStatus> {
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) {
      return { geminiConfigured: false, model: 'gemini-3.8-flash' };
    }
    return (await res.json()) as AiServerStatus;
  } catch {
    return { geminiConfigured: false, model: 'gemini-3.8-flash' };
  }
}

async function postAi<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const overrideKey = getSessionGeminiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (overrideKey) {
    headers['x-gemini-key'] = overrideKey;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      todayISO: getTodayISO(),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Error al procesar la petición con Gemini.') as Error & {
      code?: string;
    };
    error.code = data.code;
    throw error;
  }

  return data as T;
}

export async function processQuickVoiceAi(params: {
  text?: string;
  audioBase64?: string;
  mimeType?: string;
}): Promise<AiExtractionResponse> {
  return postAi<AiExtractionResponse>('/api/ai/quick-voice', params);
}

export async function processBrainDumpAi(params: {
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
}): Promise<AiExtractionResponse> {
  return postAi<AiExtractionResponse>('/api/ai/brain-dump', params);
}

export async function scanWhiteboardImageAi(params: {
  imageBase64: string;
  mimeType: string;
  isSampleWhiteboard?: boolean;
}): Promise<AiExtractionResponse> {
  return postAi<AiExtractionResponse>('/api/ai/scan-image', params);
}
