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

/* The real cartons, cut out small by docs/mockups/login_shelf.py. */
const CRATES = ['/crate-pepa.webp', '/crate-ohis.webp', '/crate-civlily.webp'];

/* ── who is on the road ────────────────────────────────────────────────────
   Nino, 9 Nov 2026: the first set "looked unrealistic" — flat rectangles with
   circles for wheels. These are drawn the way a fulfilment operation actually
   looks: a panel van with a sloped cab and a cargo door, a box lorry with a
   separate cab, and a porter walking a stacked hand trolley. Pale bodywork so
   they read as vehicles on a dark map rather than as holes in it, a red flash
   on the side because they are ours, and dark glass and tyres for weight.

   Each is drawn from its own wheels, then shifted so the origin is where the
   road is — animateMotion puts that point on the lane. */

const BODY = '#f4ece7';     // bodywork
const TYRE = '#2a0a06';     // tyres and glass
const SEAM = '#cfc0b8';     // panel seams
const CARD = '#d9b78c';     // cardboard

/** A panel van: the everyday run. */
function Van() {
  return (
    <g transform="translate(-35,-34)">
      <path d="M4 27 V8 Q4 5 7 5 H41 L45 9 H54 Q57.5 9 59.5 12 L65 20 Q67 22.5 67 25.5 V27 Q67 29.5 64.5 29.5 H6.5 Q4 29.5 4 27 Z" fill={BODY} />
      <path d="M46.5 11.5 H54 Q56 11.5 57 13 L61 19 H46.5 Z" fill={TYRE} />
      <rect x="9" y="9.5" width="30" height="2.6" rx="1.3" fill="#ee3124" />
      <path d="M25 5 V29" stroke={SEAM} strokeWidth="1.1" />
      <circle cx="17" cy="29" r="6.2" fill={TYRE} />
      <circle cx="17" cy="29" r="2.7" fill={BODY} />
      <circle cx="55" cy="29" r="6.2" fill={TYRE} />
      <circle cx="55" cy="29" r="2.7" fill={BODY} />
    </g>
  );
}

/** A box lorry: the long haul, Dar to Mwanza and Mbeya. */
function Lorry() {
  return (
    <g transform="translate(-44,-38)">
      <rect x="3" y="3" width="52" height="25" rx="2" fill={BODY} />
      <rect x="8" y="8" width="42" height="3" rx="1.5" fill="#ee3124" />
      <path d="M31 3 V28" stroke={SEAM} strokeWidth="1.2" />
      <path d="M56 28 V14 Q56 11 59 11 H68 Q71 11 73 14 L80 23 Q82 25.5 82 28.5 V30 Q82 32 80 32 H58 Q56 32 56 30 Z" fill={BODY} />
      <path d="M60 14 H68 Q70 14 71 15.5 L76 22 H60 Z" fill={TYRE} />
      <circle cx="16" cy="30" r="6" fill={TYRE} />
      <circle cx="16" cy="30" r="2.6" fill={BODY} />
      <circle cx="28" cy="30" r="6" fill={TYRE} />
      <circle cx="28" cy="30" r="2.6" fill={BODY} />
      <circle cx="69" cy="32" r="6" fill={TYRE} />
      <circle cx="69" cy="32" r="2.6" fill={BODY} />
    </g>
  );
}

/** A porter walking a loaded hand trolley: the last few hundred metres. */
function Porter() {
  return (
    <g transform="translate(-17,-38)">
      {/* the load */}
      <rect x="17" y="8" width="15" height="11" rx="1.2" fill={CARD} />
      <rect x="17" y="19" width="15" height="11" rx="1.2" fill="#c7a278" />
      <path d="M24.5 8 V30" stroke="#8d6a46" strokeWidth="1.2" />
      {/* the trolley */}
      <path d="M16 5 V32 H31" fill="none" stroke={BODY} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="33.5" r="3.6" fill={TYRE} stroke={BODY} strokeWidth="1.4" />
      {/* the person */}
      <circle cx="7" cy="7.5" r="3.6" fill={BODY} />
      <path d="M7 11 V23" stroke={BODY} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M7 14 L15 10" stroke={BODY} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M7 23 L2.5 35" stroke={BODY} strokeWidth="2.9" strokeLinecap="round" />
      <path d="M7 23 L12 34" stroke={BODY} strokeWidth="2.9" strokeLinecap="round" />
    </g>
  );
}

/** The Lab itself: a shed with its doors open, standing in Dar. */
function Warehouse({ x, y }) {
  return (
    <g transform={`translate(${x - 26},${y - 30})`}>
      <path d="M2 16 L26 3 L50 16 V31 H2 Z" fill="#ee3124" />
      <path d="M2 16 L26 3 L50 16 Z" fill="#ff8d7d" />
      <rect x="17" y="20" width="18" height="11" rx="0.8" fill="#2a0a06" />
      <rect x="20" y="23" width="12" height="8" fill="#ffb6ab" opacity="0.4" />
      {/* stock waiting on the apron */}
      <rect x="4" y="24" width="9" height="7" rx="0.8" fill={CARD} />
      <rect x="38" y="25" width="8" height="6" rx="0.8" fill={CARD} />
    </g>
  );
}

/** A region taking stock in: a small depot beside its name. */
function Depot({ x, y }) {
  return (
    <g transform={`translate(${x - 10},${y - 13})`}>
      <path d="M1 7 L10 1 L19 7 V14 H1 Z" fill="#ff5f4b" />
      <rect x="7" y="9" width="6" height="5" fill="#2a0a06" />
    </g>
  );
}

const MOVERS = [Van, Porter, Lorry, Van, Porter, Van, Lorry, Porter];

/* Where the stock goes, how long a run takes, and how far into it each one
   already is. Staggered on purpose: eight lorries leaving at once is a parade,
   not a distribution network. */
const RUNS = [
  { to: 'arusha', d: '7s', at: '-1.2s' },
  { to: 'mwanza', d: '9.5s', at: '-5.5s' },
  { to: 'dodoma', d: '5.5s', at: '-2.8s' },
  { to: 'mbeya', d: '8.5s', at: '-7s' },
  { to: 'tanga', d: '4.5s', at: '-0.6s' },
  { to: 'morogoro', d: '4s', at: '-3.2s' },
  { to: 'mtwara', d: '8s', at: '-4.4s' },
  { to: 'kigoma', d: '11s', at: '-9s' },
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
                <circle cx={cx} cy={cy} r="15" className="ls-stop-ring" style={{ '--s': `${i * 0.9}s` }} />
                <Depot x={cx} y={cy} />
              </g>
            );
          })}

          {/* The Lab itself, in Dar: everything leaves from here. */}
          <circle cx={dar[0]} cy={dar[1]} r="34" className="ls-hub-ring" />
          <Warehouse x={dar[0]} y={dar[1]} />
          {/* The stock on the road: the real cartons, small, walking the lanes.

              Inside the SVG, riding the road's own path. They were HTML
              siblings with CSS offset-path first, which works but is sized in
              pixels — so the boxes kept their 1000-unit scale while the map
              shrank to fit the screen, and came out 0.05px wide. In here they
              share the viewBox and scale with it for nothing. */}
          {RUNS.map((r, i) => {
            const Mover = MOVERS[i % MOVERS.length];
            return (
              <g key={r.to} className="ls-mover">
                <animateMotion dur={r.d} begin={r.at} repeatCount="indefinite" rotate="0">
                  <mpath href={`#ls-road-${r.to}`} />
                </animateMotion>
                <animate attributeName="opacity" dur={r.d} begin={r.at} repeatCount="indefinite"
                  values="0;1;1;0" keyTimes="0;0.08;0.9;1" />
                {/* The walk: the figure itself rises and falls inside the run,
                    so a porter trudges and a van takes the bumps. Scaled up a
                    little — at the map's own units a van is 50 wide against a
                    1000-wide country, which is true to life and too small to
                    read as a van. */}
                <g className="ls-step"><g transform="scale(1.4)"><Mover /></g></g>
              </g>
            );
          })}

          {/* And the stock going with them, a little behind — smaller than the
              vehicles, so the convoy reads lorry-first rather than a carton
              towing a van. */}
          {RUNS.map((r, i) => (
            <image key={`${r.to}-box`} href={CRATES[i % CRATES.length]} width="30" x="-15" y="-30"
              className="ls-parcel" preserveAspectRatio="xMidYMax meet">
              <animateMotion dur={r.d} begin={`${parseFloat(r.at) - parseFloat(r.d) * 0.42}s`}
                repeatCount="indefinite" rotate="0">
                <mpath href={`#ls-road-${r.to}`} />
              </animateMotion>
              <animate attributeName="opacity" dur={r.d}
                begin={`${parseFloat(r.at) - parseFloat(r.d) * 0.42}s`} repeatCount="indefinite"
                values="0;1;1;0" keyTimes="0;0.08;0.9;1" />
            </image>
          ))}
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
