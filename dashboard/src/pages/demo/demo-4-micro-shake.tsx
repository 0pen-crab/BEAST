import { useEffect, useRef, type ReactNode } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo4MicroShake() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      const x = (Math.random() - 0.5) * 3; // ±1.5px
      const y = (Math.random() - 0.5) * 3;
      el!.style.transform = `translate(${x}px, ${y}px)`;
      timer = setTimeout(tick, 30 + Math.random() * 30);
    }
    timer = setTimeout(tick, 30);
    return () => clearTimeout(timer);
  }, []);

  return (
    <BeastDemoLayout
      number={4}
      title="Micro-Shake"
      description="Rapid tiny random position jitter (±1.5px every 30-60ms) — the beast is trembling with rage."
      imageWrapper={(img: ReactNode) => (
        <div ref={wrapRef} className="h-full w-full will-change-transform">
          {img}
        </div>
      )}
    />
  );
}
