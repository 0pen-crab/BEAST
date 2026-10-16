const LINES = [
  { red: 'BE', rest: 'TTER' },
  { red: 'A', rest: 'PPLICATION' },
  { red: 'S', rest: 'ECURITY' },
  { red: 'T', rest: 'ESTING' },
] as const;

interface BeastAcronymProps {
  size?: 'sm' | 'md' | 'lg';
  restColor?: string;
}

const sizes = {
  sm: { fontSize: '10px', leading: '1.3', tracking: '0.22em' },
  md: { fontSize: '11px', leading: '1.3', tracking: '0.22em' },
  lg: { fontSize: '13px', leading: '1.45', tracking: '0.28em' },
};

export function BeastAcronym({ size = 'md', restColor = 'text-th-text-secondary' }: BeastAcronymProps) {
  const s = sizes[size];

  return (
    <div className="text-left" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {LINES.map(({ red, rest }, i) => (
        <div
          key={i}
          style={{ fontSize: s.fontSize, lineHeight: s.leading, letterSpacing: s.tracking, fontWeight: 500 }}
        >
          <span className="text-beast-red font-bold">{red}</span>
          <span className={restColor}>{rest}</span>
        </div>
      ))}
    </div>
  );
}
