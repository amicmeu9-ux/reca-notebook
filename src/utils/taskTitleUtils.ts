const LEADING_FILLERS =
  /^(?:y\s+|y\s+también\s+|también\s+|oye\s+(?:reca|reka|notebook)[,:\s]*|tengo\s+que\s+|tengo\s+(?:un|una)\s+|tengo\s+|hay\s+que\s+|necesito\s+|recu[eé]rdame\s+|acordarme\s+de\s+|recordar\s+|apuntar\s+|apunta\s+|debo\s+)/i;

const TRAILING_TIME_PHRASES =
  /(?:\s+(?:para\s+)?(?:hoy|mañana|pasado\s+mañana|esta\s+tarde|esta\s+noche|el\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)|a\s+las\s+\d{1,2}(?::\d{2})?(?:\s+de\s+la\s+(?:mañana|tarde|noche))?))+$/i;

const LEGACY_STARTER_RENAMES: Record<string, { title: string; notes?: string | null }> = {
  'Repasar apuntes del Tema 4 de Cálculo': {
    title: 'Repasar Cálculo',
    notes: 'Tema 4 · 5 ejercicios pendientes',
  },
  'Repasar Tema 4 de Cálculo': {
    title: 'Repasar Cálculo',
    notes: 'Tema 4 · 5 ejercicios pendientes',
  },
  'Parcial de Fundamentos de Física': {
    title: 'Parcial de Física',
    notes: 'Fundamentos · Aula 204 · Formulario',
  },
  'Comprar café y cuaderno de cuadros': {
    title: 'Café y cuaderno',
  },
  'Comprar café y cuaderno': {
    title: 'Café y cuaderno',
  },
  'Pedir cita para revisión dental': {
    title: 'Cita dental',
  },
  'Pedir cita dental': {
    title: 'Cita dental',
  },
  'Examen de Álgebra Lineal (Temas 1-4)': {
    title: 'Examen Álgebra Lineal',
    notes: 'Temas 1-4 · Aula 204',
  },
  'Entrega Práctica 3 de Física': {
    title: 'Práctica 3 Física',
  },
  'Parcial de Historia Contemporánea': {
    title: 'Parcial Historia',
    notes: 'Contemporánea · Aula Magna · DNI',
  },
};

export function summarizeTaskTitle(raw: string, fallback = 'Nueva tarea'): string {
  const renamed = LEGACY_STARTER_RENAMES[raw.trim()];
  if (renamed) return renamed.title;

  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s]+|[,;\s.]+$/g, '')
    .trim();

  for (let i = 0; i < 2; i += 1) {
    text = text.replace(LEADING_FILLERS, '').trim();
  }

  const withoutTime = text.replace(TRAILING_TIME_PHRASES, '').trim();
  if (withoutTime.length >= 4) {
    text = withoutTime;
  }

  text = text.replace(/^[,;\s-]+|[,;\s.-]+$/g, '').trim();
  if (!text) return fallback;

  // Compacta frases largas a un resumen corto legible (máx. 6 palabras / 46 caracteres)
  const words = text.split(' ');
  if (words.length > 6 || text.length > 46) {
    const compactWords: string[] = [];
    for (const w of words) {
      const next = [...compactWords, w].join(' ');
      if (compactWords.length >= 6 || (next.length > 44 && compactWords.length >= 2)) {
        break;
      }
      compactWords.push(w);
    }
    text = compactWords.join(' ').replace(/[,;:]+$/, '');
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getStarterTaskRename(rawTitle: string): { title: string; notes?: string | null } | null {
  return LEGACY_STARTER_RENAMES[rawTitle.trim()] ?? null;
}
