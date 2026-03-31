import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo10RedFlash() {
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = flashRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    let raf: number;

    function flash() {
      const start = performance.now();
      const duration = 300;

      function animateFlash(now: number) {
        const elapsed = now - start;
        if (elapsed > duration) {
          el!.style.opacity = '0';
          scheduleNext();
          return;
        }
        // Triangle wave: 0→peak→0
        const t = elapsed / duration;
        const opacity = t < 0.5 ? t * 2 * 0.15 : (1 - t) * 2 * 0.15;
        el!.style.opacity = String(opacity);
        raf = requestAnimationFrame(animateFlash);
      }
      raf = requestAnimationFrame(animateFlash);
    }

    function scheduleNext() {
      timer = setTimeout(flash, 15000 + Math.random() * 15000);
    }

    // First flash sooner so you can see it in the demo
    timer = setTimeout(flash, 3000 + Math.random() * 3000);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <BeastDemoLayout
      number={10}
      title="Red Flash"
      description="A subtle red overlay flashes every 15-30s like a heartbeat — barely perceptible but creates unease."
    >
      <div
        ref={flashRef}
        className="absolute inset-0 pointer-events-none bg-red-600"
        style={{ opacity: 0 }}
      />
    </BeastDemoLayout>
  );
}
