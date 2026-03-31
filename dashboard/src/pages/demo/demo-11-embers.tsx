import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  hue: number; // 0=red, 30=orange
}

export function Demo11Embers() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    const embers: Ember[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function spawnEmber() {
      embers.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + 5,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(0.5 + Math.random() * 1.5),
        size: 1 + Math.random() * 2.5,
        life: 0,
        maxLife: 150 + Math.random() * 200,
        hue: Math.random() * 30, // 0–30 (red to orange)
      });
    }

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Spawn new embers
      if (embers.length < 45 && Math.random() < 0.3) {
        spawnEmber();
      }

      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.x += e.vx + Math.sin(e.life * 0.02) * 0.3;
        e.y += e.vy;
        e.life++;

        const alpha = 1 - e.life / e.maxLife;
        if (alpha <= 0) {
          embers.splice(i, 1);
          continue;
        }

        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${e.hue}, 90%, 55%, ${alpha * 0.7})`;
        ctx!.fill();

        // Glow
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size * 3, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${e.hue}, 90%, 55%, ${alpha * 0.1})`;
        ctx!.fill();
      }

      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <BeastDemoLayout
      number={11}
      title="Particle Embers"
      description="Tiny red and orange glowing particles drift upward from the bottom — like embers rising from a fire beneath the beast."
    >
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </BeastDemoLayout>
  );
}
