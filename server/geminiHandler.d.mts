export interface GeminiTaskPayload {
  text?: string;
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
  imageBase64?: string;
  isSampleWhiteboard?: boolean;
  todayISO?: string;
  apiKeyOverride?: string;
}

export function handleQuickVoiceRequest(
  payload: GeminiTaskPayload,
  serverApiKey?: string
): Promise<unknown>;

export function handleBrainDumpRequest(
  payload: GeminiTaskPayload,
  serverApiKey?: string
): Promise<unknown>;

export function handleScanImageRequest(
  payload: GeminiTaskPayload,
  serverApiKey?: string
): Promise<unknown>;
