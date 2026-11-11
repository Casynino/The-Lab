import { useId } from 'react';

// The blue "verified" mark that sits after a name on Instagram and X (Nino, 11 Nov 2026: "I want the
// verification badge like Twitter or Instagram, nice and well made"): a soft scalloped disc with a white tick.
// Every account in this system is made by ZELab itself — nobody signs up alone — so the mark says "this is
// a real, active ZELab account". It is drawn here as plain SVG (a centre disc and eight round lobes) so it
// stays sharp at any size and needs no image file.
const LOBES = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return [12 + 7.3 * Math.cos(a), 12 + 7.3 * Math.sin(a)];
});

export default function VerifiedBadge({ className = 'h-[22px] w-[22px]', title = 'Verified' }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      className={className}
      style={{ filter: 'drop-shadow(0 0 6px rgba(29,155,240,0.45))' }}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3dacf7" />
          <stop offset="1" stopColor="#1587dc" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        <circle cx="12" cy="12" r="7.6" />
        {LOBES.map(([x, y], i) => <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r="3.9" />)}
      </g>
      <path d="M8.1 12.4l2.7 2.7 5.2-5.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
