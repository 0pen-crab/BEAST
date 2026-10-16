import { useEffect, useRef } from 'react';
import { BeastDemoLayout } from '@/components/beast-demo-layout';

export function Demo8FilmGrain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let timer: ReturnType<typeof setTimeout>;
    // Use a small canvas and scale up via CSS for performance
    canvas.width = 256;
    canvas.height = 256;

    function generateGrain() {
      const imageData = ctx!.createImageData(256, 256);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 25; // low opacity
      }
      ctx!.putImageData(imageData, 0, 0);
      timer = setTimeout(generateGrain, 80);
    }
    generateGrain();
    return () => clearTimeout(timer);
  }, []);

  return (
    <BeastDemoLayout
      number={8}
      title="Film Grain"
      description="Animated noise/grain texture overlay — gives the beast image a gritty, cinematic feel like a horror movie still."
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none mix-blend-overlay opacity-40"
        style={{ imageRendering: 'pixelated' }}
      />
    </BeastDemoLayout>
  );
}
