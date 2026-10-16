import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo7VignettePulse() {
  const vignetteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = vignetteRef.current;
    if (!el) return;
    let raf: number;
    const start = performance.now();

    function animate(now: number) {
      const t = (now - start) / 5000;
      const pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
      const inner = 40 + pulse * 15; // 40%–55% transparent center
      const opacity = 0.6 + pulse * 0.4; // 0.6–1.0
      el!.style.background = `radial-gradient(ellipse 70% 70% at 50% 40%, transparent ${inner}%, rgba(0,0,0,${opacity}) 100%)`;
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <BeastDemoLayout
      number={7}
      title="Vignette Pulse"
      description="The dark edges around the beast pulse darker and lighter — a tunnel-vision heartbeat effect focusing attention on the eyes."
    >
      <div ref={vignetteRef} className="absolute inset-0 pointer-events-none" />
    </BeastDemoLayout>
  );
}
