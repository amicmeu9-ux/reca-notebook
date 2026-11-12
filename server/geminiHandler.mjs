import { GoogleGenAI } from '@google/genai';

const MODEL_ID = 'gemini-3.8-flash';
const FALLBACK_MODELS = [MODEL_ID, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
const REQUEST_TIMEOUT_MS = 18_000;

const SUPPORTED_AUDIO_MIMES = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/mpeg',
  'audio/m4a',
  'audio/l16',
  'audio/opus',
  'audio/alaw',
  'audio/mulaw',
  'audio/webm',
]);

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function normalizeAudioMime(rawMime) {
  const base = String(rawMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'audio/m4a';
  if (base === 'audio/x-wav') return 'audio/wav';
  if (SUPPORTED_AUDIO_MIMES.has(base)) return base;
  return 'audio/webm';
}

function normalizeImageMime(rawMime) {
  const base = String(rawMime || 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (base === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_IMAGE_MIMES.has(base)) return base;
  return 'image/jpeg';
}

export function stripBase64Prefix(raw) {
  const trimmed = String(raw || '').trim();
  const marker = ';base64,';
  const idx = trimmed.indexOf(marker);
  if (trimmed.startsWith('data:') && idx !== -1) {
    return trimmed.slice(idx + marker.length).trim();
  }
  return trimmed;
}

export function parseStructuredInteractionOutput(interaction) {
  if (Array.isArray(interaction?.errors) && interaction.errors.length > 0) {
    const firstErr = interaction.errors[0];
    throw new Error(firstErr?.message || 'Gemini informó un error procesando la solicitud.');
  }

  let rawText = typeof interaction?.output_text === 'string' ? interaction.output_text.trim() : '';
  if (!rawText && Array.isArray(interaction?.outputs)) {
    rawText = interaction.outputs
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
  }

  if (!rawText) {
    throw new Error('Gemini devolvió una respuesta vacía.');
  }

  const cleanJson = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleanJson);
  } catch {
    throw new Error('Gemini devolvió un formato inesperado en vez de JSON válido.');
  }
}

const TASK_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        'Resumen limpio y muy corto de la tarea o examen en español (2 a 5 palabras, sin muletillas ni repetir fechas/horas).',
    },
    category: {
      type: 'string',
      enum: ['Estudios', 'Casa', 'Personal'],
      description: 'Categoría automática más adecuada.',
    },
    dueDate: {
      type: ['string', 'null'],
      description: 'Fecha en formato YYYY-MM-DD calculada respecto a la fecha actual, o null si no se menciona fecha.',
    },
    dueTime: {
      type: ['string', 'null'],
      description: 'Hora en formato HH:mm (24h) si se menciona, o null.',
    },
    isExam: {
      type: 'boolean',
      description: 'true si es un examen, parcial, control, test o prueba evaluable.',
    },
    notes: {
      type: ['string', 'null'],
      description: 'Detalle breve adicional como aula, temas, páginas o contexto si aparece, o null.',
    },
  },
  required: ['title', 'category', 'dueDate', 'dueTime', 'isExam', 'notes'],
};

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Resumen breve en una frase de lo extraído.',
    },
    transcript: {
      type: 'string',
      description: 'Transcripción limpia del audio o texto detectado en la imagen.',
    },
    tasks: {
      type: 'array',
      items: TASK_ITEM_SCHEMA,
      description: 'Lista de tareas individuales y exámenes detectados.',
    },
  },
  required: ['summary', 'transcript', 'tasks'],
};

function addDaysISO(baseISO, deltaDays) {
  const d = new Date(`${baseISO}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextWeekdayISO(baseISO, targetWeekday) {
  const d = new Date(`${baseISO}T12:00:00`);
  const current = d.getDay(); // 0=dom, 1=lun...
  let diff = (targetWeekday - current + 7) % 7;
  if (diff === 0) diff = 7;
  return addDaysISO(baseISO, diff);
}

function inferCategory(text) {
  const lower = text.toLowerCase();
  if (
    /\b(examen|parcial|práctica|practica|entrega|estudiar|repasar|tema|apuntes|clase|universidad|instituto|matemáticas|matematicas|física|fisica|historia|química|quimica|álgebra|algebra|cálculo|calculo|inglés|ingles|proyecto|trabajo|exposición|exposicion|profesor|profe|aula|tutoría|tutoria|pdf|diapositivas|lectura|ejercicios|deberes)\b/i.test(
      lower
    )
  ) {
    return 'Estudios';
  }
  if (
    /\b(comprar|super|supermercado|leche|pan|lavadora|limpiar|fregar|basura|cocinar|recoger|ordenar|casa|habitación|habitacion|factura|alquiler|luz|agua|plantas|regar|ropa|planchar|tienda|ferretería|ferreteria|nevera|despensa)\b/i.test(
      lower
    )
  ) {
    return 'Casa';
  }
  return 'Personal';
}

function inferIsExam(text) {
  return /\b(examen|parcial|final|recuperación|recuperacion|control|test|prueba escrita|evaluación|evaluacion)\b/i.test(
    text
  );
}

function inferDateAndTime(text, todayISO) {
  const lower = text.toLowerCase();
  let dueDate = null;
  let dueTime = null;

  if (/\bpasado\s+mañana\b/.test(lower)) {
    dueDate = addDaysISO(todayISO, 2);
  } else if (/\bmañana\b/.test(lower)) {
    dueDate = addDaysISO(todayISO, 1);
  } else if (/\bhoy\b|\besta\s+tarde\b|\besta\s+noche\b/.test(lower)) {
    dueDate = todayISO;
  } else {
    const weekdays = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miércoles: 3,
      miercoles: 3,
      jueves: 4,
      viernes: 5,
      sábado: 6,
      sabado: 6,
    };
    for (const [word, idx] of Object.entries(weekdays)) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
        dueDate = nextWeekdayISO(todayISO, idx);
        break;
      }
    }
  }

  // DD/MM o "18 de noviembre"
  if (!dueDate) {
    const slashMatch = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (slashMatch) {
      const day = Number(slashMatch[1]);
      const month = Number(slashMatch[2]);
      const baseYear = Number(todayISO.slice(0, 4));
      const year = slashMatch[3]
        ? Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3])
        : baseYear;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        dueDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }

  if (!dueDate) {
    const months = {
      enero: 1,
      febrero: 2,
      marzo: 3,
      abril: 4,
      mayo: 5,
      junio: 6,
      julio: 7,
      agosto: 8,
      septiembre: 9,
      octubre: 10,
      noviembre: 11,
      diciembre: 12,
    };
    const monthMatch = lower.match(
      /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/
    );
    if (monthMatch) {
      const day = Number(monthMatch[1]);
      const month = months[monthMatch[2]];
      const year = Number(todayISO.slice(0, 4));
      dueDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const timeMatch = lower.match(/\b(?:a\s+las\s+)?(\d{1,2}):(\d{2})\b|\b(?:a\s+las\s+)(\d{1,2})\b/);
  if (timeMatch) {
    if (timeMatch[1] && timeMatch[2]) {
      const h = Number(timeMatch[1]);
      const m = Number(timeMatch[2]);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        dueTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    } else if (timeMatch[3]) {
      let h = Number(timeMatch[3]);
      if (h >= 1 && h <= 11 && /\btarde\b|\bnoche\b/.test(lower)) {
        h += 12;
      }
      if (h >= 0 && h <= 23) {
        dueTime = `${String(h).padStart(2, '0')}:00`;
      }
    }
  }

  return { dueDate, dueTime };
}

function cleanTaskTitle(raw) {
  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s]+|[,;\s.]+$/g, '')
    .replace(
      /^(?:y\s+|también\s+|oye\s+(?:reca|reka|notebook)[,:\s]*|tengo\s+que\s+|tengo\s+(?:un|una)\s+|tengo\s+|hay\s+que\s+|necesito\s+|recu[eé]rdame\s+|acordarme\s+de\s+|recordar\s+|apuntar\s+|apunta\s+|debo\s+)/i,
      ''
    )
    .trim();

  const withoutTime = text
    .replace(
      /(?:\s+(?:para\s+)?(?:hoy|mañana|pasado\s+mañana|esta\s+tarde|esta\s+noche|el\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)|a\s+las\s+\d{1,2}(?::\d{2})?(?:\s+de\s+la\s+(?:mañana|tarde|noche))?))+$/i,
      ''
    )
    .trim();
  if (withoutTime.length >= 4) {
    text = withoutTime;
  }

  text = text.replace(/^[,;\s-]+|[,;\s.-]+$/g, '').trim();
  if (!text) return 'Nueva tarea';

  const words = text.split(' ');
  if (words.length > 6 || text.length > 46) {
    const compact = [];
    for (const w of words) {
      const next = [...compact, w].join(' ');
      if (compact.length >= 6 || (next.length > 44 && compact.length >= 2)) break;
      compact.push(w);
    }
    text = compact.join(' ').replace(/[,;:]+$/, '');
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function demoQuickVoice(text, todayISO) {
  const clean = cleanTaskTitle(text);
  const { dueDate, dueTime } = inferDateAndTime(text, todayISO);
  return {
    mode: 'demo',
    model: 'demo-local-parser',
    summary: 'Nota rápida procesada al instante (0 tomas).',
    transcript: text,
    tasks: [
      {
        title: clean,
        category: inferCategory(text),
        dueDate: dueDate ?? todayISO,
        dueTime,
        isExam: inferIsExam(text),
        notes: null,
      },
    ],
  };
}

function demoBrainDump(transcript, todayISO) {
  const actionVerbLookahead =
    '(?:tengo|comprar|llamar|estudiar|repasar|hacer|entregar|ir|pedir|limpiar|sacar|preparar|mandar|enviar|revisar|recoger|pagar|reservar|buscar|llevar|terminar|empezar|leer|ordenar)';
  const splitRegex = new RegExp(
    `(?:[.;\\n]+|\\b(?:también|además|y luego|luego|por otro lado|ah y|y también)\\b|,\\s*|\\s+y\\s+(?=${actionVerbLookahead}\\b))`,
    'i'
  );
  const parts = String(transcript || '')
    .split(splitRegex)
    .map((p) => p.replace(/^[,;\s]+|[,;\s]+$/g, '').trim())
    .filter((p) => p.length > 2);

  const chunks = parts.length > 0 ? parts : [transcript];
  const tasks = chunks.map((chunk) => {
    const { dueDate, dueTime } = inferDateAndTime(chunk, todayISO);
    return {
      title: cleanTaskTitle(chunk),
      category: inferCategory(chunk),
      dueDate: dueDate ?? todayISO,
      dueTime,
      isExam: inferIsExam(chunk),
      notes: null,
    };
  });

  return {
    mode: 'demo',
    model: 'demo-local-parser',
    summary: `Separadas ${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'} en modo local (añade GEMINI_API_KEY para IA multimodal real).`,
    transcript,
    tasks,
  };
}

function demoSampleWhiteboard(todayISO) {
  return {
    mode: 'demo',
    model: 'demo-sample-whiteboard',
    summary: 'Extraídos 2 exámenes y 1 entrega (demo).',
    transcript:
      'Pizarra Aula 204 — Examen Álgebra Lineal 18/11 10:00 (Temas 1-4) | Entrega Práctica 3 Física 21/11 23:59 | Parcial Historia Contemporánea 26/11 09:30.',
    tasks: [
      {
        title: 'Examen Álgebra Lineal',
        category: 'Estudios',
        dueDate: addDaysISO(todayISO, 7),
        dueTime: '10:00',
        isExam: true,
        notes: 'Temas 1-4 · Aula 204',
      },
      {
        title: 'Práctica 3 de Física',
        category: 'Estudios',
        dueDate: addDaysISO(todayISO, 10),
        dueTime: '23:59',
        isExam: false,
        notes: 'Subir informe PDF al campus virtual',
      },
      {
        title: 'Parcial de Historia',
        category: 'Estudios',
        dueDate: addDaysISO(todayISO, 15),
        dueTime: '09:30',
        isExam: true,
        notes: 'Contemporánea · Aula Magna · DNI',
      },
    ],
  };
}

function sanitizeTasks(rawTasks, fallbackTodayISO) {
  if (!Array.isArray(rawTasks)) return [];
  const validCategories = new Set(['Estudios', 'Casa', 'Personal']);
  return rawTasks
    .filter((item) => item && typeof item.title === 'string' && item.title.trim().length > 0)
    .map((item) => ({
      title: cleanTaskTitle(item.title),
      category: validCategories.has(item.category) ? item.category : 'Personal',
      dueDate:
        typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
          ? item.dueDate
          : fallbackTodayISO ?? null,
      dueTime:
        typeof item.dueTime === 'string' && /^\d{2}:\d{2}$/.test(item.dueTime)
          ? item.dueTime
          : null,
      isExam: Boolean(item.isExam),
      notes: typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : null,
    }));
}

export function shouldFallbackModelError(err) {
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  if (status === 401 || status === 403) return false;
  if ([404, 408, 429, 500, 502, 503, 504].includes(status)) return true;
  const name = String(err?.name || err?.constructor?.name || '');
  const msg = String(err?.message || '');
  return (
    name === 'APIConnectionTimeoutError' ||
    /timed out|timeout|high demand|deadline expired|unavailable|not found/i.test(msg)
  );
}

async function runGeminiStructured({ apiKey, input }) {
  const client = new GoogleGenAI({ apiKey });
  let lastErr = null;

  for (let i = 0; i < FALLBACK_MODELS.length; i += 1) {
    const model = FALLBACK_MODELS[i];
    try {
      const interaction = await client.interactions.create(
        {
          model,
          input,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: EXTRACTION_SCHEMA,
          },
        },
        { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 }
      );

      const parsed = parseStructuredInteractionOutput(interaction);
      return { ...parsed, _model: model };
    } catch (err) {
      lastErr = err;
      const hasNext = i < FALLBACK_MODELS.length - 1;
      if (!hasNext || !shouldFallbackModelError(err)) {
        throw err;
      }
    }
  }

  throw lastErr;
}

export async function handleQuickVoiceRequest(payload, serverApiKey) {
  const todayISO = payload.todayISO || new Date().toISOString().slice(0, 10);
  const apiKey = payload.apiKeyOverride || serverApiKey;
  const text = String(payload.text || '').trim();
  const audioBase64 = stripBase64Prefix(payload.audioBase64);
  const hasAudio = Boolean(audioBase64);

  if (!text && !hasAudio) {
    throw new Error('Debes indicar texto o audio para crear la nota rápida.');
  }

  if (!apiKey) {
    if (!text) {
      throw new Error(
        'Para transcribir audio sin transcripción en vivo necesitas configurar GEMINI_API_KEY en .env.'
      );
    }
    return demoQuickVoice(text, todayISO);
  }

  const prompt = `Eres el asistente de la app "Reca" para estudiantes y personas despistadas.
Hoy es ${todayISO}.
Convierte esta nota de voz rápida en exactamente UNA tarea clara en español.
Reglas para title: resumen limpio y muy corto (máximo 2 a 5 palabras, sin "tengo que", "recordar" ni fechas/horas repetidas en el título; coloca los detalles extra en notes).
Calcula dueDate (YYYY-MM-DD) si se menciona hoy, mañana, un día de la semana o fecha (si no menciona fecha, usa ${todayISO} si suena para hoy o null si es atemporal).
Clasifica en exactamente una categoría: "Estudios", "Casa" o "Personal".
Marca isExam=true solo si habla de un examen, parcial, control o prueba evaluable.${
    text ? `\nTexto dictado: "${text}"` : ''
  }`;

  const input = hasAudio
    ? [
        { type: 'text', text: prompt },
        {
          type: 'audio',
          data: audioBase64,
          mime_type: normalizeAudioMime(payload.mimeType),
        },
      ]
    : prompt;

  const parsed = await runGeminiStructured({ apiKey, input });
  const tasks = sanitizeTasks(parsed.tasks, todayISO);
  return {
    mode: 'gemini',
    model: parsed._model || MODEL_ID,
    summary: parsed.summary || 'Nota rápida estructurada con Gemini.',
    transcript: parsed.transcript || text,
    tasks: tasks.slice(0, 1),
  };
}

export async function handleBrainDumpRequest(payload, serverApiKey) {
  const todayISO = payload.todayISO || new Date().toISOString().slice(0, 10);
  const apiKey = payload.apiKeyOverride || serverApiKey;
  const transcript = String(payload.transcript || '').trim();
  const audioBase64 = stripBase64Prefix(payload.audioBase64);
  const hasAudio = Boolean(audioBase64);

  if (!transcript && !hasAudio) {
    throw new Error('No se recibió audio ni texto para el vaciado mental.');
  }

  if (!apiKey) {
    if (!transcript) {
      throw new Error(
        'No hay transcripción de voz en este navegador y falta GEMINI_API_KEY en .env para procesar el audio directamente.'
      );
    }
    return demoBrainDump(transcript, todayISO);
  }

  const prompt = `Eres el motor de IA de la app "Reca" para estudiantes y personas despistadas.
Hoy es ${todayISO}.
El usuario ha hecho un vaciado mental largo mezclando varias tareas, exámenes, recados o planes.
Separa TODAS las acciones distintas en tarjetas individuales claras en español.
Para cada tarea:
- title: resumen limpio y muy corto (2 a 5 palabras, p. ej. "Parcial de Física", "Comprar café"; sin "tengo que" ni fechas/horas en el título).
- category: exactamente "Estudios", "Casa" o "Personal".
- dueDate: fecha exacta YYYY-MM-DD si menciona día relativo o fecha (usa ${todayISO} como referencia), o null.
- dueTime: hora HH:mm si la menciona, o null.
- isExam: true si es examen, parcial, control o prueba.
- notes: detalles útiles como asignatura, aula o lista breve, o null.${
    transcript ? `\nTranscripción auxiliar del navegador: "${transcript}"` : ''
  }`;

  const input = hasAudio
    ? [
        { type: 'text', text: prompt },
        {
          type: 'audio',
          data: audioBase64,
          mime_type: normalizeAudioMime(payload.mimeType),
        },
      ]
    : prompt;

  const parsed = await runGeminiStructured({ apiKey, input });
  const tasks = sanitizeTasks(parsed.tasks, todayISO);
  return {
    mode: 'gemini',
    model: parsed._model || MODEL_ID,
    summary: parsed.summary || `Gemini separó ${tasks.length} tareas de tu audio.`,
    transcript: parsed.transcript || transcript,
    tasks,
  };
}

export async function handleScanImageRequest(payload, serverApiKey) {
  const todayISO = payload.todayISO || new Date().toISOString().slice(0, 10);
  const apiKey = payload.apiKeyOverride || serverApiKey;
  const imageBase64 = stripBase64Prefix(payload.imageBase64);

  if (!imageBase64) {
    throw new Error('Falta la imagen de la pizarra o apuntes.');
  }

  if (!apiKey) {
    if (payload.isSampleWhiteboard) {
      return demoSampleWhiteboard(todayISO);
    }
    const err = new Error(
      'Falta GEMINI_API_KEY en el servidor (.env) para analizar fotos reales de pizarra o apuntes. Añádela para usar Gemini 3.8 Flash Vision (o prueba la pizarra de ejemplo).'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }

  const prompt = `Eres el escáner académico de "Reca".
Hoy es ${todayISO}.
Analiza esta foto de una pizarra de clase, agenda o apuntes escritos a mano/impresos.
Extrae TODAS las fechas de exámenes, parciales, entregas de prácticas, trabajos o tareas visibles.
Devuelve cada elemento como una tarjeta individual en español:
- title: resumen limpio y corto del examen o entrega (2 a 5 palabras, sin fechas ni aula en el título).
- category: "Estudios" (o "Casa"/"Personal" si claramente corresponde a otra cosa).
- dueDate: fecha en formato YYYY-MM-DD (infiere el año actual ${todayISO.slice(0, 4)} si solo dice día/mes; si la fecha ya pasó este año respecto a ${todayISO} por muchos meses, usa el año siguiente).
- dueTime: hora en formato HH:mm si aparece en la pizarra, o null.
- isExam: true para exámenes, controles, parciales o finales; false para entregas/prácticas/tareas.
- notes: aula, temas que entran, profesor o detalles importantes visibles en la imagen.`;

  const parsed = await runGeminiStructured({
    apiKey,
    input: [
      { type: 'text', text: prompt },
      {
        type: 'image',
        data: imageBase64,
        mime_type: normalizeImageMime(payload.mimeType),
      },
    ],
  });

  const tasks = sanitizeTasks(parsed.tasks, null);
  return {
    mode: 'gemini',
    model: parsed._model || MODEL_ID,
    summary: parsed.summary || `Extraídos ${tasks.length} elementos de la imagen.`,
    transcript: parsed.transcript || '',
    tasks,
  };
}
