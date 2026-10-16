import { useEffect, useRef, type ReactNode } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo6ShadowBreathe() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf: number;
    const start = performance.now();

    function animate(now: number) {
      const t = (now - start) / 7500; // match breathing cycle
      const breath = Math.sin(t * Math.PI * 2) * 0.5 + 0.5; // 0→1→0
      const blur = 20 + breath * 60; // 20px → 80px
      const opacity = 0.15 + breath * 0.25;
      el!.style.filter = `drop-shadow(0 0 ${blur}px rgba(220,38,38,${opacity}))`;
      el!.style.transform = `scale(${1 + breath * 0.08})`; // subtle scale sync
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <BeastDemoLayout
      number={6}
      title="Shadow Breathe"
      description="A red drop-shadow aura expands and contracts around the beast in sync with a breathing rhythm."
      imageWrapper={(img: ReactNode) => (
        <div ref={wrapRef} className="h-full w-full will-change-[filter,transform]">
          {img}
        </div>
      )}
    />
  );
}
