type LogoProps = {
  size?: number;
  className?: string;
  withWordmark?: boolean;
  variant?: 'organic' | 'geometric';
};

export function Logo({ size = 20, className, withWordmark = false, variant = 'organic' }: LogoProps) {
  const aspect = withWordmark ? 'aspect-[3.6/1]' : 'aspect-[2/1]';
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg
        viewBox="0 0 400 200"
        width={size * 2}
        height={size}
        className={`${aspect} shrink-0`}
        aria-label="Cellproject"
        role="img"
      >
        {variant === 'organic' ? (
          <g stroke="currentColor" strokeLinecap="round" fill="none">
            <path d="M 40 100 L 220 100" strokeWidth="5" />
            <path d="M 220 100 C 260 100, 300 60, 360 20" strokeWidth="3.5" />
            <path d="M 220 100 L 360 100" strokeWidth="3.5" />
            <path d="M 220 100 C 260 100, 300 140, 360 180" strokeWidth="3.5" />
          </g>
        ) : (
          <g stroke="currentColor" strokeLinecap="round" fill="none">
            <line x1="40" y1="100" x2="220" y2="100" strokeWidth="5" />
            <line x1="220" y1="100" x2="360" y2="20" strokeWidth="3.5" />
            <line x1="220" y1="100" x2="360" y2="100" strokeWidth="3.5" />
            <line x1="220" y1="100" x2="360" y2="180" strokeWidth="3.5" />
          </g>
        )}
        <circle cx="40" cy="100" r="8" className="fill-ai-accent" />
        <circle cx="360" cy="20" r="6" className="fill-ai-accent" />
        <circle cx="360" cy="100" r="6" className="fill-ai-accent" />
        <circle cx="360" cy="180" r="6" className="fill-ai-accent" />
      </svg>
      {withWordmark && (
        <span className="font-semibold tracking-tight text-text-primary text-sm leading-none">
          cellproject
        </span>
      )}
    </span>
  );
}
