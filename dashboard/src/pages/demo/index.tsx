import { Link } from 'react-router';

const demos = [
  { n: 1, title: 'Eye Glow Pulse', desc: 'Red glow behind eyes intensifies and dims' },
  { n: 2, title: 'Eye Tracking', desc: 'Red glow follows mouse cursor position' },
  { n: 3, title: 'Vertical Drift', desc: 'Slow random vertical bob ±5px' },
  { n: 4, title: 'Micro-Shake', desc: 'Fast tiny random translate jitter 1-2px' },
  { n: 5, title: 'Tilt', desc: 'Slow random rotation ±2deg' },
  { n: 6, title: 'Shadow Breathe', desc: 'Drop-shadow expands/contracts with pulse' },
  { n: 7, title: 'Vignette Pulse', desc: 'Dark edges pulse darker/lighter with breathing' },
  { n: 8, title: 'Film Grain', desc: 'Animated noise/grain texture overlay' },
  { n: 9, title: 'Chromatic Aberration', desc: 'Slight RGB channel split, glitchy menacing look' },
  { n: 10, title: 'Red Flash', desc: 'Occasional heartbeat red overlay flash every 15-30s' },
  { n: 11, title: 'Particle Embers', desc: 'Tiny red/orange dots drifting up from bottom' },
];

export function DemoIndexPage() {
  return (
    <div className="min-h-screen bg-beast-black px-8 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <img src="/beast.png" alt="BEAST" className="h-10 w-10" />
          <span className="font-display text-4xl tracking-[0.12em] text-white">BEAST</span>
        </div>
        <h1 className="font-display text-2xl tracking-wide text-white mb-1 mt-6">
          Animation Mockups
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Each page showcases one animation effect on the beast head. Pick your favorites.
        </p>
        <div className="space-y-2">
          {demos.map((d) => (
            <Link
              key={d.n}
              to={`/demo/${d.n}`}
              className="flex items-center gap-4 px-4 py-3 border-2 border-[#2a2a2a] hover:border-beast-red/50 transition-colors group"
            >
              <span className="font-display text-2xl text-beast-red w-8">{String(d.n).padStart(2, '0')}</span>
              <div>
                <p className="text-sm font-semibold text-white group-hover:text-beast-red-light transition-colors">{d.title}</p>
                <p className="text-xs text-gray-500">{d.desc}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8">
          <Link to="/login" className="text-sm text-gray-500 hover:text-white transition-colors">
            &larr; Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
