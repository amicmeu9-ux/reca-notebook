export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No se pudo leer el archivo.'));
        return;
      }
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Error leyendo datos binarios.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageToJpeg(
  file: Blob,
  maxDimension = 1600,
  quality = 0.86
): Promise<{ base64: string; mimeType: 'image/jpeg'; previewDataUrl: string }> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('La imagen no se pudo cargar.'));
      el.src = bitmapUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo preparar el lienzo de imagen.');
    }

    ctx.fillStyle = '#0B1220';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const previewDataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = previewDataUrl.split(',')[1] || '';
    return { base64, mimeType: 'image/jpeg', previewDataUrl };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

/**
 * Genera una foto realista de pizarra de clase en Canvas para poder probar el Escáner
 * inmediatamente incluso sin tener unos apuntes a mano.
 */
export function generateSampleWhiteboardImage(): {
  base64: string;
  mimeType: 'image/jpeg';
  previewDataUrl: string;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas no disponible.');
  }

  // Fondo pizarra gris carbón (#161618) con marco sutil (#242428)
  ctx.fillStyle = '#161618';
  ctx.fillRect(0, 0, 1200, 800);

  ctx.strokeStyle = '#242428';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 1192, 792);

  // Texto estilo tiza Blanco Hueso y Gris Plata
  ctx.fillStyle = '#F5F5F7';
  ctx.font = 'bold 42px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('FECHAS IMPORTANTES — AULA 204', 76, 110);

  ctx.strokeStyle = '#52525B';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(76, 132);
  ctx.lineTo(740, 132);
  ctx.stroke();

  ctx.fillStyle = '#F5F5F7';
  ctx.font = '600 34px "Inter", sans-serif';
  ctx.fillText('1) EXAMEN ÁLGEBRA LINEAL', 80, 235);
  ctx.fillStyle = '#8E8E93';
  ctx.font = '500 28px "JetBrains Mono", monospace';
  ctx.fillText('-> 18/11 · 10:00 · Temas 1-4 (Calculadora básica)', 115, 285);

  ctx.fillStyle = '#F5F5F7';
  ctx.font = '600 34px "Inter", sans-serif';
  ctx.fillText('2) PRÁCTICA 3 FÍSICA', 80, 415);
  ctx.fillStyle = '#8E8E93';
  ctx.font = '500 28px "JetBrains Mono", monospace';
  ctx.fillText('-> 21/11 · 23:59 · PDF en Campus Virtual', 115, 465);

  ctx.fillStyle = '#F5F5F7';
  ctx.font = '600 34px "Inter", sans-serif';
  ctx.fillText('3) PARCIAL HISTORIA CONTEMPORÁNEA', 80, 595);
  ctx.fillStyle = '#8E8E93';
  ctx.font = '500 28px "JetBrains Mono", monospace';
  ctx.fillText('-> 26/11 · 09:30 · Aula Magna (DNI obligatorio)', 115, 645);

  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64 = previewDataUrl.split(',')[1] || '';
  return { base64, mimeType: 'image/jpeg', previewDataUrl };
}

export function playFeedbackTone(kind: 'wake' | 'check' | 'spark' | 'error'): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playNote = (freq: number, start: number, duration: number, gainPeak = 0.08) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.exponentialRampToValueAtTime(gainPeak, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.02);
    };

    if (kind === 'wake') {
      playNote(587.33, 0, 0.12, 0.09);
      playNote(880, 0.1, 0.18, 0.09);
    } else if (kind === 'check') {
      playNote(660, 0, 0.09, 0.06);
      playNote(990, 0.07, 0.13, 0.05);
    } else if (kind === 'spark') {
      playNote(523.25, 0, 0.09, 0.06);
      playNote(659.25, 0.07, 0.09, 0.06);
      playNote(1046.5, 0.14, 0.18, 0.07);
    } else {
      playNote(260, 0, 0.16, 0.07);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch {
    // Ignorar silenciosamente si el navegador bloquea audio sin interacción
  }
}
