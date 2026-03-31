import { type ReactNode } from 'react';
import { Link } from 'react-router';

interface BeastDemoLayoutProps {
  number: number;
  title: string;
  description: string;
  children?: ReactNode;
  /** Wrap the image element itself (for transform-based effects) */
  imageWrapper?: (img: ReactNode) => ReactNode;
  /** Extra className on the image */
  imageClassName?: string;
  /** Extra style on the image */
  imageStyle?: React.CSSProperties;
}

const TOTAL_DEMOS = 11;

export function BeastDemoLayout({
  number,
  title,
  description,
  children,
  imageWrapper,
  imageClassName = '',
  imageStyle,
}: BeastDemoLayoutProps) {
  const prev = number > 1 ? `/demo/${number - 1}` : null;
  const next = number < TOTAL_DEMOS ? `/demo/${number + 1}` : null;

  const img = (
    <img
      src="/beast_large.png"
      alt=""
      className={`h-full w-full object-cover ${imageClassName}`}
      style={{ objectPosition: '50% 40%', ...imageStyle }}
      draggable={false}
    />
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-beast-black">
      {/* Beast image (optionally wrapped for transform effects) */}
      <div className="absolute inset-0">
        {imageWrapper ? imageWrapper(img) : img}
      </div>

      {/* Effect-specific overlays */}
      {children}

      {/* Label overlay — top left */}
      <div className="absolute top-6 left-6 z-20 pointer-events-none">
        <p className="font-display text-[64px] leading-none text-white/20">
          {String(number).padStart(2, '0')}
        </p>
        <h1 className="font-display text-2xl tracking-wide text-white mt-1">
          {title}
        </h1>
        <p className="text-[13px] text-gray-500 mt-1 max-w-xs">
          {description}
        </p>
      </div>

      {/* Navigation — bottom center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4">
        {prev ? (
          <Link to={prev} className="px-4 py-2 bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors">
            &larr; Prev
          </Link>
        ) : (
          <span className="px-4 py-2 bg-white/5 text-gray-600 text-sm">&larr; Prev</span>
        )}
        <Link to="/demo" className="px-4 py-2 bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors">
          Index
        </Link>
        {next ? (
          <Link to={next} className="px-4 py-2 bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors">
            Next &rarr;
          </Link>
        ) : (
          <span className="px-4 py-2 bg-white/5 text-gray-600 text-sm">Next &rarr;</span>
        )}
      </div>
    </div>
  );
}
