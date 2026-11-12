interface SparkAmountProps {
  value: number | string;
  prefix?: string;
  tone?: 'accent' | 'muted';
  className?: string;
  iconClassName?: string;
}

/**
 * Renderiza el saldo o importe de Tomas con el disco REC en acento quirurgico o monocromo sutil.
 */
export function SparkAmount({
  value,
  prefix = '',
  tone = 'muted',
  className = '',
  iconClassName = 'h-3.5 w-3.5',
}: SparkAmountProps) {
  const formatted = typeof value === 'number' ? value.toLocaleString('es-ES') : value;
  const strokeColor = tone === 'accent' ? 'var(--nb-accent)' : 'currentColor';
  const ringOpacity = tone === 'accent' ? '0.48' : '0.42';

  return (
    <span className={`font-mono-tabular inline-flex items-center gap-1 whitespace-nowrap ${className}`}>
      <span>
        {prefix}
        {formatted}
      </span>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`shrink-0 ${iconClassName}`}
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke={strokeColor}
          strokeOpacity={ringOpacity}
          strokeWidth="2"
        />
        <circle cx="12" cy="12" r="4.8" fill={strokeColor} />
      </svg>
    </span>
  );
}
