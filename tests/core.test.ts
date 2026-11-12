import { describe, expect, it } from 'vitest';
import { BRAND_CONFIG, formatCurrencyAmount } from '../src/config/brand';
import type { NotebookTask } from '../src/types/notebook';
import { addDaysISO, formatDueDateEs, getDailyCooldownStatus, getTodayISO } from '../src/utils/dateUtils';
import { buildBackupJson, parseBackupJson } from '../src/utils/backupUtils';
import { buildIcsContent } from '../src/utils/icsUtils';
import {
  buildReminderKey,
  findDueReminders,
  formatReminderMessage,
} from '../src/utils/reminderUtils';
import { summarizeTaskTitle } from '../src/utils/taskTitleUtils';
import { canRedeemPendingReferral, normalizeReferralCode } from '../src/utils/referralUtils';
import {
  handleBrainDumpRequest,
  handleQuickVoiceRequest,
  handleScanImageRequest,
  parseStructuredInteractionOutput,
  shouldFallbackModelError,
  stripBase64Prefix,
} from '../server/geminiHandler.mjs';
import {
  decodeFirestoreFields,
  encodeFirestoreValue,
  parseServiceAccountInput,
} from '../server/firestoreAdminRest.mjs';
import {
  getPaymentsStatus,
  handleCreateCheckoutSession,
  verifyStripeSignature,
} from '../server/paymentsHandler.mjs';
import crypto from 'node:crypto';

describe('Brand & Currency', () => {
  it('usa Reca y Tomas como identidad configurada', () => {
    expect(BRAND_CONFIG.appName).toBe('Reca');
    expect(BRAND_CONFIG.wakePhraseDisplay).toBe('Oye Reca');
    expect(BRAND_CONFIG.currency.nameSingular).toBe('Toma');
    expect(BRAND_CONFIG.currency.namePlural).toBe('Tomas');
  });

  it('formatea cantidades en singular y plural correctamente', () => {
    expect(formatCurrencyAmount(0)).toBe('0 tomas');
    expect(formatCurrencyAmount(1)).toBe('1 toma');
    expect(formatCurrencyAmount(20)).toBe('20 tomas');
  });
});

describe('summarizeTaskTitle', () => {
  it('limpia muletillas y frase de activación Oye Reca / Oye Notebook', () => {
    expect(summarizeTaskTitle('Oye Reca tengo que estudiar álgebra hoy')).toBe('Estudiar álgebra');
    expect(summarizeTaskTitle('Oye notebook recuérdame comprar café el viernes a las 10')).toBe('Comprar café');
  });

  it('usa fallback cuando la entrada queda vacía', () => {
    expect(summarizeTaskTitle('   ')).toBe('Nueva tarea');
  });
});

describe('dateUtils', () => {
  it('formatea fechas relativas respecto a hoy', () => {
    const today = getTodayISO();
    const tomorrow = addDaysISO(today, 1);

    expect(formatDueDateEs(null)).toEqual({ label: 'Sin fecha', tone: 'none' });
    expect(formatDueDateEs(today, '18:00')).toEqual({ label: 'Hoy · 18:00', tone: 'today' });
    expect(formatDueDateEs(tomorrow)).toEqual({ label: 'Mañana', tone: 'soon' });
  });

  it('calcula correctamente el cooldown diario de 24h', () => {
    const now = Date.UTC(2026, 10, 11, 15, 0, 0);
    expect(getDailyCooldownStatus(null, now).canClaim).toBe(true);

    const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const blocked = getDailyCooldownStatus(recent, now);
    expect(blocked.canClaim).toBe(false);
    expect(blocked.label).toBe('22h 00m 00s');

    const expired = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(getDailyCooldownStatus(expired, now).canClaim).toBe(true);
  });
});

describe('buildIcsContent', () => {
  const sampleTasks: NotebookTask[] = [
    {
      id: 'task_exam_1',
      title: 'Parcial de Física',
      category: 'Estudios',
      dueDate: '2026-11-18',
      dueTime: '10:30',
      isExam: true,
      completed: false,
      completedAt: null,
      source: 'scanner',
      notes: 'Aula 204, Temas 1;2',
      createdAt: '2026-11-11T10:00:00Z',
    },
    {
      id: 'task_all_day_2',
      title: 'Café y cuaderno',
      category: 'Casa',
      dueDate: '2026-11-12',
      dueTime: null,
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'voice_quick',
      notes: null,
      createdAt: '2026-11-11T10:00:00Z',
    },
    {
      id: 'task_nodate_3',
      title: 'Sin fecha',
      category: 'Personal',
      dueDate: null,
      dueTime: null,
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'manual',
      notes: null,
      createdAt: '2026-11-11T10:00:00Z',
    },
  ];

  it('genera VEVENT con hora para exámenes, todo el día sin hora, y omite tareas sin fecha', () => {
    const ics = buildIcsContent(sampleTasks, 'Reca');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-CALNAME:Reca');
    expect(ics).toContain('SUMMARY:[Examen] Parcial de Física');
    expect(ics).toContain('DTSTART:20261118T103000');
    expect(ics).toContain('DTEND:20261118T113000');
    expect(ics).toContain('TRIGGER:-PT2H');
    expect(ics).toContain('Notas: Aula 204\\, Temas 1\\;2');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261112');
    expect(ics).toContain('DTEND;VALUE=DATE:20261113');
    expect(ics).not.toContain('task_nodate_3');
    expect(ics).toContain('END:VCALENDAR');
  });
});

describe('server/geminiHandler local fallback', () => {
  it('extrae una nota rápida en modo demo', async () => {
    const res = (await handleQuickVoiceRequest({
      text: 'Oye Reca examen de Historia mañana a las 09:00',
      todayISO: '2026-11-11',
    })) as { mode: string; tasks: Array<{ title: string; dueDate: string | null; dueTime: string | null; isExam: boolean }> };

    expect(res.mode).toBe('demo');
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0].isExam).toBe(true);
    expect(res.tasks[0].dueDate).toBe('2026-11-12');
    expect(res.tasks[0].dueTime).toBe('09:00');
  });

  it('separa varias tareas en vaciado mental local', async () => {
    const res = (await handleBrainDumpRequest({
      transcript: 'Comprar café hoy, también repasar cálculo mañana y pedir cita médica',
      todayISO: '2026-11-11',
    })) as { mode: string; tasks: Array<{ category: string }> };

    expect(res.mode).toBe('demo');
    expect(res.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it('permite pizarra de ejemplo sin clave y exige API key para fotos reales', async () => {
    const demo = (await handleScanImageRequest({
      imageBase64: 'ZmFrZQ==',
      mimeType: 'image/jpeg',
      isSampleWhiteboard: true,
      todayISO: '2026-11-11',
    })) as { mode: string; tasks: unknown[] };

    expect(demo.mode).toBe('demo');
    expect(demo.tasks.length).toBeGreaterThan(0);

    await expect(
      handleScanImageRequest({
        imageBase64: 'ZmFrZQ==',
        mimeType: 'image/jpeg',
        isSampleWhiteboard: false,
        todayISO: '2026-11-11',
      })
    ).rejects.toMatchObject({ code: 'NO_API_KEY' });
  });
});

describe('findDueReminders', () => {
  const nowLocal = new Date(2026, 10, 11, 10, 0, 0, 0).getTime();

  const tasks: NotebookTask[] = [
    {
      id: 't_soon',
      title: 'Entregar práctica',
      category: 'Estudios',
      dueDate: '2026-11-11',
      dueTime: '10:25',
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'manual',
      notes: null,
      createdAt: '2026-11-11T08:00:00Z',
    },
    {
      id: 't_too_far',
      title: 'Comprar pan',
      category: 'Casa',
      dueDate: '2026-11-11',
      dueTime: '10:45',
      isExam: false,
      completed: false,
      completedAt: null,
      source: 'manual',
      notes: null,
      createdAt: '2026-11-11T08:00:00Z',
    },
    {
      id: 't_exam_window',
      title: 'Parcial de Física',
      category: 'Estudios',
      dueDate: '2026-11-11',
      dueTime: '11:30',
      isExam: true,
      completed: false,
      completedAt: null,
      source: 'scanner',
      notes: null,
      createdAt: '2026-11-11T08:00:00Z',
    },
    {
      id: 't_done',
      title: 'Ya completada',
      category: 'Personal',
      dueDate: '2026-11-11',
      dueTime: '10:10',
      isExam: false,
      completed: true,
      completedAt: '2026-11-11T09:00:00Z',
      source: 'manual',
      notes: null,
      createdAt: '2026-11-11T08:00:00Z',
    },
  ];

  it('detecta ventanas de 30 min para tareas, 2 h para exámenes e ignora completadas o lejanas', () => {
    const due = findDueReminders(tasks, nowLocal, new Set());
    expect(due.map((item) => item.task.id)).toEqual(['t_soon', 't_exam_window']);
    expect(due[0].minutesLeft).toBe(25);
    expect(formatReminderMessage(due[1])).toBe('Examen en 90 min: «Parcial de Física»');
  });

  it('evita duplicados usando las claves ya notificadas', () => {
    const sent = new Set([buildReminderKey(tasks[0])]);
    const due = findDueReminders(tasks, nowLocal, sent);
    expect(due.map((item) => item.task.id)).toEqual(['t_exam_window']);
  });
});

describe('backupUtils (Zod)', () => {
  it('exporta e importa copias JSON válidas conservando los datos clave', () => {
    const source: NotebookTask[] = [
      {
        id: 't_1',
        title: 'Examen Álgebra',
        category: 'Estudios',
        dueDate: '2026-11-15',
        dueTime: '09:30',
        isExam: true,
        completed: false,
        completedAt: null,
        source: 'scanner',
        notes: 'Aula 12',
        createdAt: '2026-11-11T09:00:00Z',
      },
    ];

    const json = buildBackupJson(source);
    const parsed = parseBackupJson(json);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.tasks).toEqual([
        {
          title: 'Examen Álgebra',
          category: 'Estudios',
          dueDate: '2026-11-15',
          dueTime: '09:30',
          isExam: true,
          notes: 'Aula 12',
        },
      ]);
    }
  });

  it('rechaza JSON corrupto o esquemas incompatibles con mensajes claros', () => {
    expect(parseBackupJson('{no-valido').ok).toBe(false);
    expect(parseBackupJson(JSON.stringify({ version: 2, app: 'Reca', tasks: [] })).ok).toBe(false);
    expect(
      parseBackupJson(
        JSON.stringify({
          version: 1,
          app: 'Reca',
          exportedAt: '2026-11-11T10:00:00Z',
          tasks: [{ title: 'Mal formato', dueDate: '15/11/2026' }],
        })
      ).ok
    ).toBe(false);
  });
});

describe('referralUtils', () => {
  it('valida códigos de invitación RC y NB normalizados', () => {
    expect(normalizeReferralCode(' rc-9a2f ')).toBe('RC-9A2F');
    expect(normalizeReferralCode('NB-AB12')).toBe('NB-AB12');
    expect(normalizeReferralCode('invalid')).toBeNull();
  });

  it('permite canjear códigos ajenos una vez y bloquea autoinvitación o duplicados', () => {
    expect(
      canRedeemPendingReferral({
        pendingCode: 'rc-amig9',
        ownReferralCode: 'RC-PROPIO',
        alreadyRedeemedCode: null,
      })
    ).toEqual({ eligible: true, code: 'RC-AMIG9' });

    expect(
      canRedeemPendingReferral({
        pendingCode: 'RC-PROPIO',
        ownReferralCode: 'RC-PROPIO',
        alreadyRedeemedCode: null,
      }).reason
    ).toBe('self');

    expect(
      canRedeemPendingReferral({
        pendingCode: 'RC-AMIG9',
        ownReferralCode: 'RC-PROPIO',
        alreadyRedeemedCode: 'RC-OTRO1',
      }).reason
    ).toBe('already_redeemed');
  });
});

describe('geminiHandler helpers', () => {
  it('limpia prefijos data URL en base64 y valida salidas estructuradas', () => {
    expect(stripBase64Prefix('data:image/jpeg;base64, /9j/4AAQ ')).toBe('/9j/4AAQ');
    expect(stripBase64Prefix('AQID')).toBe('AQID');

    expect(
      parseStructuredInteractionOutput({
        output_text: '```json\n{"summary":"Ok","transcript":"Hola","tasks":[]}\n```',
      })
    ).toEqual({ summary: 'Ok', transcript: 'Hola', tasks: [] });

    expect(
      parseStructuredInteractionOutput({
        outputs: [{ type: 'text', text: '{"summary":"S","transcript":"T","tasks":[]}' }],
      })
    ).toEqual({ summary: 'S', transcript: 'T', tasks: [] });

    expect(() =>
      parseStructuredInteractionOutput({ errors: [{ message: 'Cuota excedida' }] })
    ).toThrow('Cuota excedida');
    expect(() => parseStructuredInteractionOutput({ output_text: '' })).toThrow('respuesta vacía');
  });

  it('decide correctamente cuándo hacer fallback a otro modelo Flash', () => {
    expect(shouldFallbackModelError({ status: 503, message: 'high demand' })).toBe(true);
    expect(shouldFallbackModelError({ status: 429, message: 'rate limit' })).toBe(true);
    expect(shouldFallbackModelError({ name: 'APIConnectionTimeoutError', message: 'Request timed out' })).toBe(true);
    expect(shouldFallbackModelError({ status: 401, message: 'API key not valid' })).toBe(false);
    expect(shouldFallbackModelError({ status: 403, message: 'Forbidden' })).toBe(false);
  });
});

describe('firestoreAdminRest helpers', () => {
  it('parsea credenciales de servicio JSON planas o en base64 y normaliza private_key', () => {
    const sample = {
      project_id: 'reca-demo',
      client_email: 'sa@reca-demo.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
    };
    const rawJson = JSON.stringify(sample);
    const parsedDirect = parseServiceAccountInput(rawJson);
    expect(parsedDirect?.project_id).toBe('reca-demo');
    expect(parsedDirect?.private_key).toContain('\nABC\n');

    const b64 = Buffer.from(rawJson, 'utf8').toString('base64');
    const parsedB64 = parseServiceAccountInput(b64);
    expect(parsedB64?.client_email).toBe(sample.client_email);

    expect(parseServiceAccountInput('{"project_id":"incompleto"}')).toBeNull();
    expect(parseServiceAccountInput('')).toBeNull();
  });

  it('codifica y decodifica tipos de valor Firestore REST correctamente', () => {
    const encoded = {
      uid: encodeFirestoreValue('user-1'),
      sparkBalance: encodeFirestoreValue(150),
      ratio: encodeFirestoreValue(1.5),
      active: encodeFirestoreValue(true),
      deletedAt: encodeFirestoreValue(null),
      tags: encodeFirestoreValue(['a', 'b']),
      meta: encodeFirestoreValue({ tier: 'pro' }),
    };

    expect(decodeFirestoreFields(encoded)).toEqual({
      uid: 'user-1',
      sparkBalance: 150,
      ratio: 1.5,
      active: true,
      deletedAt: null,
      tags: ['a', 'b'],
      meta: { tier: 'pro' },
    });
  });
});

describe('paymentsHandler helpers', () => {
  it('verifica Stripe-Signature HMAC-SHA256 válida, rechaza manipulaciones y expiradas', () => {
    const webhookSecret = 'whsec_test_secret_123';
    const rawBody = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
    const nowSec = 1_800_000_000;
    const sig = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${nowSec}.${rawBody}`)
      .digest('hex');

    expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: `t=${nowSec},v1=${sig}`,
        webhookSecret,
        nowSeconds: nowSec + 10,
      })
    ).toBe(true);

    expect(
      verifyStripeSignature({
        rawBody: `${rawBody} `,
        signatureHeader: `t=${nowSec},v1=${sig}`,
        webhookSecret,
        nowSeconds: nowSec + 10,
      })
    ).toBe(false);

    expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: `t=${nowSec},v1=${sig}`,
        webhookSecret,
        nowSeconds: nowSec + 600,
      })
    ).toBe(false);
  });

  it('reporta estado demo sin Stripe y valida packId en checkout', async () => {
    const status = getPaymentsStatus({});
    expect(status.mode).toBe('demo');
    expect(status.stripeConfigured).toBe(false);
    expect(status.packs.length).toBeGreaterThanOrEqual(2);

    const demoCheckout = await handleCreateCheckoutSession({ packId: 'pack_500' }, {});
    expect(demoCheckout.mode).toBe('demo');

    await expect(handleCreateCheckoutSession({ packId: 'inexistente' }, {})).rejects.toThrow(
      'Paquete de recarga no válido'
    );
  });
});
