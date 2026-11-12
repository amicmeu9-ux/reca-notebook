import type { TaskCategory } from '../types/notebook';
import packsConfig from './packs.json';

/**
 * Configuración centralizada de marca, moneda virtual y tarifas.
 * Cambia estos valores aquí para renombrar la app o la moneda en toda la interfaz.
 */
export const BRAND_CONFIG = {
  appName: 'Reca',
  tagline: 'Habla o fotografía. Nosotros lo ordenamos.',
  wakePhrase: 'oye reca',
  wakePhraseVariants: ['oye reca', 'oye reka', 'oyé reca', 'oí reca', 'oye rec', 'hoy reca'],
  wakePhraseDisplay: 'Oye Reca',
  currency: {
    symbol: '◉',
    nameSingular: 'Toma',
    namePlural: 'Tomas',
    initialBalance: 100,
    dailyBonus: 10,
    referralBonus: packsConfig.referralBonus,
  },
  costs: {
    quickVoice: 0,
    brainDump: 20,
    scanner: 40,
  },
  packs: packsConfig.packs,
} as const;

export const CATEGORY_META: Record<
  TaskCategory,
  {
    label: TaskCategory;
    description: string;
    dotClass: string;
  }
> = {
  Estudios: {
    label: 'Estudios',
    description: 'Clases, entregas y exámenes',
    dotClass: 'bg-[#F5F5F7]',
  },
  Casa: {
    label: 'Casa',
    description: 'Compras, recados y hogar',
    dotClass: 'bg-[#A1A1AA]',
  },
  Personal: {
    label: 'Personal',
    description: 'Salud, planes y vida diaria',
    dotClass: 'bg-[#71717A]',
  },
};

export const CATEGORIES: TaskCategory[] = ['Estudios', 'Casa', 'Personal'];

/**
 * Formatea una cantidad junto al nombre de la unidad en singular o plural (p. ej. "20 tomas").
 */
export function formatCurrencyAmount(amount: number): string {
  const unit =
    Math.abs(amount) === 1
      ? BRAND_CONFIG.currency.nameSingular.toLowerCase()
      : BRAND_CONFIG.currency.namePlural.toLowerCase();
  return `${amount} ${unit}`;
}
