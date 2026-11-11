import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

// Its own file because it is plain SVG: the profile page draws rings and no
// other chart, so it should not have to download the chart library (recharts,
// which RepCharts brings) to show them. RepCharts re-exports it.

/** A ring: segments laid round a circle, a number in the middle. The arcs grow in; under reduced motion they are simply there. */
export function Ring({ total, segments, size = 104, stroke = 11, children }) {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (reduce) { setOn(true); return undefined; }
    const t = setTimeout(() => setOn(true), 60);
    return () => clearTimeout(t);
  }, [reduce]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        {segments.filter((x) => x.value > 0).map((x, i) => {
          const len = (x.value / Math.max(1, total)) * c;
          const el = (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.color} strokeWidth={stroke}
              strokeDasharray={`${on ? Math.max(0, len - 1.5) : 0} ${c}`} strokeDashoffset={-offset}
              style={{ transition: reduce ? 'none' : 'stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
