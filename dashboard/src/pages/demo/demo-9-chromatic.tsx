import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo9Chromatic() {
  const redRef = useRef<HTMLDivElement>(null);
  const blueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const red = redRef.current;
    const blue = blueRef.current;
    if (!red || !blue) return;
    let raf: number;
    const start = performance.now();

    function animate(now: number) {
      const t = (now - start) / 4000;
      const offsetX = Math.sin(t * Math.PI * 2) * 3;
      const offsetY = Math.cos(t * Math.PI * 2 * 0.7) * 1.5;
      red!.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
      blue!.style.transform = `translate(${-offsetX * 0.7}px, ${-offsetY * 0.5}px)`;
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const imgClass = 'absolute inset-0 h-full w-full object-cover';
  const imgStyle = { objectPosition: '50% 40%' };

  return (
    <BeastDemoLayout
      number={9}
      title="Chromatic Aberration"
      description="Slight RGB channel split — the red and blue layers shift 2-3px creating a glitchy, menacing look."
    >
      {/* Blue channel */}
      <div ref={blueRef} className="absolute inset-0 pointer-events-none will-change-transform" style={{ mixBlendMode: 'screen' }}>
        <img src="/beast_large.png" alt="" className={imgClass} style={{ ...imgStyle, filter: 'grayscale(1) brightness(0.5)' }} draggable={false} />
        <div className="absolute inset-0 bg-blue-600/30" />
      </div>
      {/* Red channel */}
      <div ref={redRef} className="absolute inset-0 pointer-events-none will-change-transform" style={{ mixBlendMode: 'screen' }}>
        <img src="/beast_large.png" alt="" className={imgClass} style={{ ...imgStyle, filter: 'grayscale(1) brightness(0.5)' }} draggable={false} />
        <div className="absolute inset-0 bg-red-600/30" />
      </div>
    </BeastDemoLayout>
  );
}
