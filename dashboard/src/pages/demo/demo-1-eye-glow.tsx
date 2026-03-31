import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo1EyeGlow() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = glowRef.current;
    if (!el) return;
    let raf: number;
    let target = 0.3;
    let current = 0.15;
    let targetSize = 35;
    let currentSize = 35;
    let nextChange = performance.now() + 2000;

    function animate(now: number) {
      if (now > nextChange) {
        target = 0.1 + Math.random() * 0.4;
        targetSize = 30 + Math.random() * 20;
        nextChange = now + 1500 + Math.random() * 3000;
      }
      current += (target - current) * 0.02;
      currentSize += (targetSize - currentSize) * 0.02;
      el!.style.background = `radial-gradient(ellipse ${currentSize}% ${currentSize * 0.85}% at 48% 38%, rgba(220,38,38,${current}) 0%, transparent 100%)`;
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <BeastDemoLayout
      number={1}
      title="Eye Glow Pulse"
      description="Red glow behind the eyes intensifies and dims on a random organic cycle — like the beast is focusing its attention."
    >
      <div ref={glowRef} className="absolute inset-0 pointer-events-none" />
    </BeastDemoLayout>
  );
}
