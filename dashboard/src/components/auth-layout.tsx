import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BeastAcronym } from '@/components/beast-acronym';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

function useRandomFlicker(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      if (el) el.style.transform = 'scaleX(1)';
      return;
    }
    let flipped = false;
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      flipped = !flipped;
      el!.style.transform = flipped ? 'scaleX(-1)' : 'scaleX(1)';
      timer = setTimeout(tick, 70 + Math.random() * 80);
    }
    timer = setTimeout(tick, 30 + Math.random() * 30);
    return () => clearTimeout(timer);
  }, [ref, enabled]);
}

function useBeastAnimation(
  shakeRef: React.RefObject<HTMLDivElement | null>,
  eyeLeftRef: React.RefObject<HTMLDivElement | null>,
  eyeRightRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const shakeEl = shakeRef.current;
    const eyeL = eyeLeftRef.current;
    const eyeR = eyeRightRef.current;
    if (!shakeEl || !eyeL || !eyeR || !enabled) {
      if (shakeEl) shakeEl.style.transform = 'translateY(0) scale(1)';
      return;
    }
    let raf: number;
    let targetY = 0;
    let currentY = 0;
    let nextShake = performance.now() + 200;

    function animate(now: number) {
      const breath = Math.sin((now % 7500) / 7500 * Math.PI * 2) * 0.5 + 0.5;
      const scale = 1 + breath * 0.1;

      if (now > nextShake) {
        targetY = (Math.random() - 0.5) * 6;
        nextShake = now + 80 + Math.random() * 150;
      }
      currentY += (targetY - currentY) * 0.08;
      shakeEl!.style.transform = `translateY(${currentY}px) scale(${scale})`;

      const opacity = 0.4 + breath * 0.6;
      eyeL!.style.opacity = String(opacity);
      eyeR!.style.opacity = String(opacity);

      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [shakeRef, eyeLeftRef, eyeRightRef, enabled]);
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  hue: number;
}

function useEmbers(ref: React.RefObject<HTMLCanvasElement | null>, enabled: boolean) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    const embers: Ember[] = [];

    function resize() {
      canvas!.width = canvas!.offsetWidth;
      canvas!.height = canvas!.offsetHeight;
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
        hue: Math.random() * 30,
      });
    }

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

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
  }, [ref, enabled]);
}

export function AuthLayout({ children, title }: AuthLayoutProps) {
  const flickerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const eyeLeftRef = useRef<HTMLDivElement>(null);
  const eyeRightRef = useRef<HTMLDivElement>(null);
  const embersRef = useRef<HTMLCanvasElement>(null);
  const [beastVisible, setBeastVisible] = useState(true);
  const [panelExpanded, setPanelExpanded] = useState(true);

  function toggleBeast() {
    if (beastVisible) {
      // Hiding: collapse panel immediately, kind beast appears after delay
      setBeastVisible(false);
      setPanelExpanded(false);
    } else {
      // Showing: hide kind beast first, then expand panel after 0.5s
      setBeastVisible(true);
      setTimeout(() => setPanelExpanded(true), 500);
    }
  }

  useRandomFlicker(flickerRef, panelExpanded);
  useBeastAnimation(shakeRef, eyeLeftRef, eyeRightRef, panelExpanded);
  useEmbers(embersRef, panelExpanded);

  return (
    <div className="flex min-h-screen relative" style={{ background: '#000' }}>
      {/* ── LEFT: Beast image panel (desktop) ── */}
      <div
        className="hidden lg:block relative overflow-hidden flex-shrink-0"
        style={{
          background: '#000',
          width: panelExpanded ? '50%' : '0%',
          opacity: panelExpanded ? 1 : 0,
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease',
        }}
      >
        {/* Beast head */}
        <div ref={flickerRef} className="absolute inset-0">
          <div ref={shakeRef} className="h-full w-full will-change-transform">
            <img
              src="/beast_large.png"
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: '50% 40%', transform: 'scale(0.9)' }}
              draggable={false}
            />
          </div>
        </div>

        {/* Eye glows — two small positioned dots with box-shadow */}
        <div
          ref={eyeLeftRef}
          className="absolute pointer-events-none rounded-full"
          style={{ left: '36%', top: '41%', width: 200, height: 200, transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, rgba(220,38,38,0.7) 0%, rgba(220,38,38,0.35) 40%, transparent 70%)', }}
        />
        <div
          ref={eyeRightRef}
          className="absolute pointer-events-none rounded-full"
          style={{ left: '63%', top: '41%', width: 200, height: 200, transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, rgba(220,38,38,0.7) 0%, rgba(220,38,38,0.35) 40%, transparent 70%)', }}
        />
        <canvas ref={embersRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* Right fade → merges into form panel */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to right, transparent 55%, #111 100%)' }}
        />
        {/* Bottom vignette */}
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        {/* Top vignette */}
        <div className="absolute top-0 left-0 right-0 h-1/5 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
        {/* Left vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to right, #000 0%, transparent 25%)' }}
        />
      </div>

      {/* ── Red line separator (desktop only) ── */}
      <div
        className="hidden lg:block absolute z-15 pointer-events-none"
        style={{
          left: panelExpanded ? '50%' : '0px',
          top: 0,
          bottom: 0,
          width: '1px',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(to bottom, transparent 5%, #dc2626 20%, #dc2626 80%, transparent 95%)',
          opacity: panelExpanded ? 1 : 0,
          transition: 'left 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease',
        }}
      />

      {/* ── Chevron toggle button (desktop only) ── */}
      <button
        onClick={toggleBeast}
        className="hidden lg:flex items-center justify-center flex-shrink-0 cursor-pointer absolute z-20"
        style={{
          left: panelExpanded ? '50%' : '50px',
          top: '45%',
          transform: 'translate(-50%, -50%)',
          width: '54px',
          height: '54px',
          background: '#111',
          border: '1px solid #dc2626',
          borderRadius: '50%',
          boxShadow: '0 0 12px rgba(220,38,38,0.25)',
          transition: 'left 0.6s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s, background 0.2s, box-shadow 0.3s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#dc2626';
          e.currentTarget.style.boxShadow = '0 0 25px rgba(220,38,38,0.5)';
          const svg = e.currentTarget.querySelector('svg') as SVGElement;
          if (svg) svg.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#111';
          e.currentTarget.style.boxShadow = '0 0 12px rgba(220,38,38,0.25)';
          const svg = e.currentTarget.querySelector('svg') as SVGElement;
          if (svg) svg.style.color = '#dc2626';
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          className="w-[21px] h-[21px]"
          style={{
            strokeWidth: 2.5,
            color: '#dc2626',
            transform: panelExpanded ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.3s ease, color 0.2s',
          }}
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* ── Kind beast (appears when main beast is hidden) ── */}
      <div
        className="hidden lg:block absolute pointer-events-none"
        style={{
          bottom: '-75px',
          left: '-90px',
          width: '290px',
          height: '300px',
          zIndex: 10,
          transform: beastVisible
            ? 'rotate(25deg) translate(-300px, 100px)'
            : 'rotate(25deg) translate(0px, 0px)',
          visibility: beastVisible ? 'hidden' : 'visible',
          transition: beastVisible
            ? 'transform 0.6s ease-in, visibility 0s 0.6s'
            : 'transform 0.5s cubic-bezier(0.3, 1.3, 0.5, 1) 1s, visibility 0s 1s',
        }}
      >
        <img
          src="/beast_kind.png"
          alt=""
          draggable={false}
          className="w-full h-full object-contain will-change-transform"
          style={{
            backfaceVisibility: 'hidden',
            animation: beastVisible ? 'none' : 'kindBeastTilt 3s ease-in-out 1.5s infinite',
          }}
        />
      </div>

      {/* ── RIGHT: Form panel ── */}
      <div
        className="flex flex-1 flex-col"
        style={{ background: '#111' }}
      >
        {/* Mobile: compact beast header */}
        <div className="lg:hidden relative h-[30vh] overflow-hidden bg-beast-black">
          <img
            src="/beast_large.png"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: '50% 35%' }}
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-beast-black via-beast-black/40 to-transparent" />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 60% 50% at 50% 35%, rgba(220,38,38,0.15) 0%, transparent 100%)',
            }}
          />
          <div className="absolute bottom-0 left-[10%] right-[10%] h-[2px] bg-gradient-to-r from-transparent via-beast-red/30 to-transparent" />
        </div>

        <div className="flex flex-1 flex-col justify-center py-12">
          <div className="w-full max-w-md mx-auto px-8">
            {/* Branding */}
            <div className="mb-12 animate-fade-up">
              <div className="flex items-center gap-6">
                <span
                  className="text-[82px] leading-[0.85] tracking-[0.08em] text-beast-red"
                  style={{ fontFamily: "'Anton', sans-serif" }}
                >
                  BEAST
                </span>
                <div
                  className="h-[95px] flex-shrink-0"
                  style={{
                    width: '1.5px',
                    background:
                      'linear-gradient(to bottom, transparent, #dc2626, transparent)',
                  }}
                />
                <BeastAcronym size="lg" restColor="text-[#e0e0e0]" />
              </div>
            </div>

            {/* Title */}
            <div className="mb-8 animate-fade-up" style={{ animationDelay: '0.1s' }}>
              <h1 className="font-display text-[26px] tracking-wide text-white leading-tight">
                {title}
              </h1>
            </div>

            {/* Form content */}
            <div className="w-full max-w-sm animate-fade-up" style={{ animationDelay: '0.2s' }}>
              {children}
            </div>

            {/* Footer */}
            <div className="mt-auto pt-16 animate-fade-up" style={{ animationDelay: '0.3s' }}>
              <p className="text-[10px] tracking-[0.2em] uppercase text-gray-700">
                v{__APP_VERSION__}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
