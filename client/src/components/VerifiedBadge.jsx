// The blue "verified" mark that sits after a name on Instagram and X (Nino, 11 Nov 2026: "I want the
// verification badge like Twitter or Instagram" — then, "small, and well fitted, like Instagram's"): a flat
// blue disc with a softly scalloped edge and a white tick, about the height of the name's capital letters,
// right after the name. No glow, no gradient — Instagram's is flat. Every account in this system is made by
// ZELab itself (nobody signs up alone), so the mark says "a real, active ZELab account". Plain SVG: a centre
// disc and twelve small round lobes, so it stays sharp at any size and needs no image file.
const LOBES = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  return [(12 + 8.2 * Math.cos(a)).toFixed(2), (12 + 8.2 * Math.sin(a)).toFixed(2)];
});

export default function VerifiedBadge({ className = 'h-4 w-4', title = 'Verified' }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={title} className={className}>
      <title>{title}</title>
      <g fill="#0095f6">
        <circle cx="12" cy="12" r="9" />
        {LOBES.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.9" />)}
      </g>
      <path d="M7.9 12.3l2.75 2.75 5.45-5.6" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
