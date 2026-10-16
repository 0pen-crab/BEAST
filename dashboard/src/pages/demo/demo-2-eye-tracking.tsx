import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo2EyeTracking() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = glowRef.current;
    if (!el) return;
    let cx = 48, cy = 38; // base eye position (%)
    let targetCx = cx, targetCy = cy;

    function onMove(e: MouseEvent) {
      // Map mouse position to ±10% offset from eye center
      const rx = (e.clientX / window.innerWidth - 0.5) * 2;  // -1 to 1
      const ry = (e.clientY / window.innerHeight - 0.5) * 2;
      targetCx = 48 + rx * 8;
      targetCy = 38 + ry * 6;
    }

    let raf: number;
    function animate() {
      cx += (targetCx - cx) * 0.05;
      cy += (targetCy - cy) * 0.05;
      el!.style.background = `radial-gradient(ellipse 35% 30% at ${cx}% ${cy}%, rgba(220,38,38,0.25) 0%, transparent 100%)`;
      raf = requestAnimationFrame(animate);
    }

    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(animate);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <BeastDemoLayout
      number={2}
      title="Eye Tracking"
      description="The red eye glow subtly shifts position to follow your mouse cursor — the beast is watching you."
    >
      <div ref={glowRef} className="absolute inset-0 pointer-events-none" />
    </BeastDemoLayout>
  );
}
