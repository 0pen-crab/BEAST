import { useEffect, useRef, type ReactNode } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo5Tilt() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf: number;
    let targetRot = 0;
    let currentRot = 0;
    let nextChange = performance.now() + 2000;

    function animate(now: number) {
      if (now > nextChange) {
        targetRot = (Math.random() - 0.5) * 4; // ±2deg
        nextChange = now + 3000 + Math.random() * 4000;
      }
      currentRot += (targetRot - currentRot) * 0.01;
      el!.style.transform = `rotate(${currentRot}deg)`;
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <BeastDemoLayout
      number={5}
      title="Tilt"
      description="Slow random rotation ±2° with organic easing — the beast is sizing you up, tilting its head."
      imageWrapper={(img: ReactNode) => (
        <div ref={wrapRef} className="h-full w-full will-change-transform" style={{ transformOrigin: '50% 40%' }}>
          {img}
        </div>
      )}
    />
  );
}
