import { useEffect, useRef, type ReactNode } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo3VerticalDrift() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf: number;
    let targetY = 0;
    let currentY = 0;
    let nextChange = performance.now() + 1000;

    function animate(now: number) {
      if (now > nextChange) {
        targetY = (Math.random() - 0.5) * 10; // ±5px
        nextChange = now + 2000 + Math.random() * 3000;
      }
      currentY += (targetY - currentY) * 0.015;
      el!.style.transform = `translateY(${currentY}px)`;
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <BeastDemoLayout
      number={3}
      title="Vertical Drift"
      description="The beast slowly bobs up and down ±5px on a random organic cycle — like it's breathing and shifting weight."
      imageWrapper={(img: ReactNode) => (
        <div ref={wrapRef} className="h-full w-full will-change-transform">
          {img}
        </div>
      )}
    />
  );
}
