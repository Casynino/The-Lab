import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, Eye, EyeOff, ArrowRight, ArrowUpRight, Boxes, Timer, Coins, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Field, Input } from '@/components/ui';
import TZ from './tanzania';
import './login.css';

/**
 * The sign-in screen.
 *
 * Nino, 9 Nov 2026, holding up Super Drive's: one full screen with the brand
 * on it, the product standing in it, and — on a phone — ONE button, so the
 * scene is never buried under a form. Pressing it opens the form as a pop-up.
 * From `md` up there is room for both, and the card simply sits on the page.
 *
 * What used to be here was a tall marketing page: hero, four counters, four
 * perk cards, a credit line. On a phone that is four screens of scrolling
 * before the password field, and none of it is read twice.
 */

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const FACTS = [
  { icon: Boxes, label: 'Live stock' },
  { icon: Timer, label: '72-hour settlement' },
  { icon: Coins, label: 'Commission per box' },
];

/** The delay before a thing rises into place. */
const rise = (s) => ({ '--rd': `${s}s` });

// ── The mark ─────────────────────────────────────────────────────────────────

/**
 * Hao Labs' own lockup, the official artwork — the red hǎo and the word in
 * Nino's own lettering, cut out of the brand files by docs/mockups/brand.py.
 * It was a drawn cube in a tile before, which is a picture of a box, not a
 * logo (Nino, 9 Nov 2026).
 */
function Mark({ size = 'md' }) {
  const big = size === 'lg';
  return (
    <img
      src="/brand/hao-labs-dark.png"
      alt="Hao Labs"
      width="1071"
      height="320"
      className={`w-auto drop-shadow-[0_10px_30px_rgba(0,0,0,0.65)] ${big ? 'h-[4.25rem] sm:h-20' : 'h-14 sm:h-16'}`}
    />
  );
}

// ── The scene ────────────────────────────────────────────────────────────────

/* The country, and the work.
 *
 * Nino, 9 Nov 2026: "show a map of Tanzania, moving boxes — this is a world
 * class distribution channel". So the sign-in screen is the business drawn
 * once: the Lab in Dar es Salaam, the regions it supplies, and stock on the
 * road between them. The outline is real coordinates, simplified and
 * projected by docs/mockups/tanzania.py — not a doodle of a country shape.
 *
 * Every moving part is a transform or an opacity on its own layer, so the
 * whole thing is the compositor's work and none of it is the main thread's.
 */

/* ── the fleet ─────────────────────────────────────────────────────────────
   Nino, 9 Nov 2026, holding up bongolife.app: the scene should look real, not
   like flat drawings. Bongo Life gets that with a 5.6 MB video on every visit,
   which is too much for a tool his reps open several times a day on mobile
   data. So the objects are RENDERED in 3D — lit, with real shadows, by
   docs/mockups/fleet.py — and the browser moves them. The whole set is about
   50 KB and stays sharp at any size.

   Everything is drawn facing left, which is the way out of Dar on every route
   but Mtwara; that one is mirrored. */

const FLEET = {
  lorry: { src: '/fleet/lorry.webp', w: 300, h: 209, on: 96 },
  van: { src: '/fleet/van.webp', w: 230, h: 167, on: 78 },
  warehouse: { src: '/fleet/warehouse.webp', w: 340, h: 206, on: 170 },
  depot: { src: '/fleet/depot.webp', w: 170, h: 125, on: 58 },
  ship: { src: '/fleet/ship.webp', w: 380, h: 234, on: 170 },
};

/** One rendered object, standing on the point given. */
function Piece({ of, x, y, flip = false, className }) {
  const p = FLEET[of];
  const w = p.on;
  const h = (p.h / p.w) * w;
  return (
    <image href={p.src} width={w} height={h} x={-w / 2} y={-h}
      transform={`translate(${x},${y})${flip ? ' scale(-1,1)' : ''}`}
      className={className} preserveAspectRatio="xMidYMax meet" />
  );
}

/* Where the stock goes, how long a run takes, how far into it each lorry
   already is, and what is driving it. Staggered on purpose: eight lorries
   leaving at once is a parade, not a distribution network. */
const RUNS = [
  { to: 'arusha', d: '17s', at: '-2s', of: 'lorry' },
  { to: 'mwanza', d: '23s', at: '-13s', of: 'lorry' },
  { to: 'dodoma', d: '13s', at: '-7s', of: 'van' },
  { to: 'mbeya', d: '21s', at: '-17s', of: 'lorry' },
  { to: 'tanga', d: '11s', at: '-1.5s', of: 'van' },
  { to: 'morogoro', d: '10s', at: '-8s', of: 'van' },
  { to: 'mtwara', d: '19s', at: '-11s', of: 'lorry' },
  { to: 'kigoma', d: '27s', at: '-22s', of: 'lorry' },
];

function Scene() {
  const { w, h, border, victoria, cities, routes } = TZ;
  const dar = cities.dar;

  return (
    <div className="ls" aria-hidden="true">
      <span className="ls-glow a" />
      <span className="ls-glow b" />

      <div className="ls-map">
        <svg viewBox={`0 0 ${w} ${h}`} className="ls-svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="ls-land" x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" stopColor="rgb(238 49 36 / 0.26)" />
              <stop offset="60%" stopColor="rgb(238 49 36 / 0.09)" />
              <stop offset="100%" stopColor="rgb(255 95 75 / 0.02)" />
            </linearGradient>
          </defs>

          {/* The country: filled faintly, drawn in the house red. */}
          <path d={border} fill="url(#ls-land)" stroke="rgb(255 95 75 / 0.8)" strokeWidth="2.5"
            strokeLinejoin="round" className="ls-border" />
          {/* Lake Victoria, cut out of the north so the shape is readable. */}
          <path d={victoria} fill="#070606" stroke="rgb(255 95 75 / 0.22)" strokeWidth="1.6" />

          {/* The roads out of the Lab. The dash crawls, so a lane reads as a
              route being worked rather than a line drawn on a map. Each one is
              named, because the cartons below ride these exact paths. */}
          {RUNS.map((r) => (
            <path key={r.to} id={`ls-road-${r.to}`} d={routes[r.to]} fill="none"
              stroke="rgb(255 95 75 / 0.30)" strokeWidth="1.6" strokeLinecap="round"
              className="ls-road" style={{ '--d': r.d }} />
          ))}

          {/* Where the stock lands: a depot, and the ring it puts out when a
              delivery arrives. */}
          {RUNS.map((r, i) => {
            const [cx, cy] = cities[r.to];
            return (
              <g key={r.to}>
                <circle cx={cx} cy={cy} r="16" className="ls-stop-ring" style={{ '--s': `${i * 1.1}s` }} />
                <Piece of="depot" x={cx} y={cy + 4} />
              </g>
            );
          })}

          {/* A ship standing off the coast: what arrives before any of this. */}
          <g className="ls-ship">
            <Piece of="ship" x={w - 18} y={h * 0.78} />
          </g>

          {/* The fleet on the road, each riding its own route. The whole run
              is slow — a lorry crossing Tanzania should take its time, and
              slow motion is what he asked for. */}
          {RUNS.map((r) => {
            const east = cities[r.to][0] > dar[0];   // Mtwara, and only Mtwara
            return (
              <g key={r.to} className="ls-mover">
                <animateMotion dur={r.d} begin={r.at} repeatCount="indefinite" rotate="0">
                  <mpath href={`#ls-road-${r.to}`} />
                </animateMotion>
                <animate attributeName="opacity" dur={r.d} begin={r.at} repeatCount="indefinite"
                  values="0;1;1;0" keyTimes="0;0.06;0.92;1" />
                {/* The road under it: a long haul is never perfectly level. */}
                <g className="ls-step"><Piece of={r.of} x={0} y={0} flip={east} /></g>
              </g>
            );
          })}

          {/* The Lab itself, in Dar: everything leaves from here, so it is
              painted last and the fleet pulls out from behind it. */}
          <circle cx={dar[0]} cy={dar[1]} r="46" className="ls-hub-ring" />
          <Piece of="warehouse" x={dar[0] - 6} y={dar[1] + 10} />
        </svg>
      </div>

      <div className="ls-vignette" />
    </div>
  );
}

// ── The pop-up ───────────────────────────────────────────────────────────────

/**
 * On a phone the form must not cover the scene: the page shows one button, and
 * pressing it opens the card over a dimmed screen (Escape, the X, or a tap
 * outside closes it). From `md` up `md:contents` makes this wrapper disappear
 * and the card is simply on the page, exactly where it was.
 */
function Gate({ children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={rise(0.5)}
        className="ls-up inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-brand-500 px-8 text-[15px] font-bold text-white shadow-[0_10px_30px_-10px_rgba(238,49,36,0.85)] transition active:scale-[0.98] hover:bg-brand-600 md:hidden"
      >
        Log in
        <ArrowRight className="h-4 w-4" />
      </button>

      {/* No "Get the full-screen app" link here any more (owner, 9 Nov 2026).
          The sheet offers itself once, on its own, the first time a phone
          reaches the app after signing in — see InstallPrompt in Layout. Once
          dismissed it stays dismissed; a standing link on the way in was the
          same offer sitting there every single visit. */}

      <div
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        className={`md:contents ${open
          ? 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:items-start max-md:justify-center max-md:bg-[#040605]/60 max-md:p-5 max-md:pt-[13vh] max-md:backdrop-blur-sm'
          : 'max-md:hidden'}`}
      >
        <div className={`relative w-full max-w-sm ${open ? 'ls-pop md:animate-none' : ''}`}>
          {children}
          {open && (
            <button type="button" onClick={() => setOpen(false)} aria-label="Close"
              className="absolute right-3 top-3 grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-elevated hover:text-foreground md:hidden">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Who built it — one quiet line to Nino's own page and his work.
 *
 * Nino, 9 Nov 2026, holding up the same line on the Vegas Luxury Hotel site:
 * "down there add Developed by Nino… when someone clicks he should get a full
 * page of my projects". That page is /nino.
 */
function Credit() {
  return (
    <Link to="/nino" className="group inline-flex items-center gap-1 text-white/45 transition-colors hover:text-white">
      Developed by <span className="font-semibold text-white/75 transition-colors group-hover:text-[#c6f432]">Nino</span>
      <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </Link>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function Login() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPwd, setShowPwd] = useState(false);
  const from = location.state?.from?.pathname || '/';

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (!loading && isAuthenticated) return <Navigate to={from} replace />;

  const onSubmit = async (values) => {
    const res = await login(values.email, values.password);
    if (res.ok) {
      toast.success(`Welcome back, ${res.user.name.split(' ')[0]}`);
      navigate(from, { replace: true });
    } else {
      toast.error(res.message);
    }
  };

  /* overflow-x only. A phone held sideways has 390 pixels of height and the
     card alone is taller than that, so the page has to be allowed to scroll —
     clipping it put the Log in button out of reach. The scene is fixed, so it
     stays where it is while the words move over it.

     data-login-scene: the stylesheet switches the status strip off here and
     paints the body the scene's own colour — this one screen runs under the
     phone's clock on purpose. */
  return (
    <div data-login-scene className="relative isolate min-h-dvh overflow-x-hidden bg-[#070907] text-white">
      <Scene />

      <div className="relative z-10 grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* The words — a computer has a column to itself for them. */}
        <section className="hidden flex-col justify-between p-12 lg:flex">
          <div className="ls-up w-fit" style={rise(0.05)}><Mark size="lg" /></div>

          <div className="mb-[clamp(170px,30vh,320px)] max-w-lg">
            <p className="ls-up mb-5 h-1 w-12 rounded bg-brand-500" style={rise(0.18)} />
            <h2 className="ls-up text-balance text-4xl font-bold leading-[1.08] tracking-tight xl:text-5xl" style={rise(0.26)}>
              We keep Tanzania <span className="text-brand-500">stocked.</span>
            </h2>
            <p className="ls-up mt-4 max-w-md text-[15px] leading-relaxed text-white/65" style={rise(0.4)}>
              Every box that leaves the Lab is on the system — who took it, what came
              back, and what is still owed.
            </p>
            <ul className="ls-up mt-7 flex flex-wrap gap-2" style={rise(0.54)}>
              {FACTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[13px] text-white/90 backdrop-blur-sm">
                  <Icon className="h-[15px] w-[15px] text-brand-500" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {/* The line that names the system. On a computer it stands in the
              corner of the words column; under the card it would print itself
              across a carton. */}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
            <span>Hao Labs · Distribution Channels</span>
            <Credit />
          </p>
        </section>

        {/* The way in. On a phone this column is the whole screen. */}
        {/* A phone gives the whole screen to this one column, so the brand and
            the way in sit in the middle of the air ABOVE the cartons, not at
            the top of the glass: pb-[36vh] is the room the shelf wants. */}
        <section className="flex flex-col items-center justify-center px-5 pb-[max(36vh,calc(3rem+env(safe-area-inset-bottom)))] pt-[max(1.75rem,env(safe-area-inset-top))] md:pb-[max(4rem,calc(3rem+env(safe-area-inset-bottom)))] lg:px-10 lg:py-10">
          <div className="ls-up mb-7 lg:hidden" style={rise(0.05)}><Mark /></div>

          <p className="ls-up mb-7 max-w-[15rem] text-balance text-center text-[15px] leading-snug text-white/80 md:hidden" style={rise(0.3)}>
            We keep Tanzania stocked.
          </p>

          <Gate>
            <div className="ls-up card w-full border-white/10 bg-surface/85 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:p-7" style={rise(0.22)}>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Log in</h1>
              <p className="mt-1 text-sm text-muted">Enter your details to start working.</p>

              <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
                <Field label="Email" error={errors.email?.message} required>
                  <Input type="email" autoComplete="username" inputMode="email" placeholder="you@thelab.co.tz" {...register('email')} />
                </Field>
                <Field label="Password" error={errors.password?.message} required>
                  <div className="relative">
                    <Input type={showPwd ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" {...register('password')} />
                    <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-faint hover:text-muted">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
                <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base">
                  {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Log in <ArrowRight className="h-5 w-5" /></>}
                </button>
              </form>
            </div>
          </Gate>

          {/* Pinned to the foot of the screen, not left under the card: on a
              tablet the card floats halfway up and the line would print
              itself across a carton. */}
          <p className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 text-center text-xs text-white/45 lg:hidden">
            <span>Hao Labs · Distribution Channels</span>
            <Credit />
          </p>
        </section>
      </div>
    </div>
  );
}
