import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, Eye, EyeOff, ArrowRight, Boxes, Timer, Coins, Smartphone, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Field, Input } from '@/components/ui';
import { InstallButton } from '@/components/InstallApp';
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

/** The open carton, drawn exactly as client/public/favicon.svg draws it. */
function Carton({ className }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M32 13 L51 24 V40 L32 51 L13 40 V24 Z" />
      <path d="M32 13 V32 M32 32 L51 24 M32 32 L13 24" />
    </svg>
  );
}

function Mark({ size = 'md' }) {
  const big = size === 'lg';
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className={`grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-slate-950 shadow-[0_14px_38px_-12px_rgba(132,204,22,0.65)] ${big ? 'h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]' : 'h-14 w-14'}`}>
        <Carton className={big ? 'h-9 w-9 sm:h-10 sm:w-10' : 'h-8 w-8'} />
      </span>
      <span className="leading-none">
        <span className={`block font-black uppercase tracking-[0.12em] text-white ${big ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}>
          The Lab
        </span>
        <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.34em] text-brand-500 sm:text-[11px]">
          Hao Stock
        </span>
      </span>
    </div>
  );
}

// ── The scene ────────────────────────────────────────────────────────────────

function Scene() {
  return (
    <div className="ls" aria-hidden="true">
      <span className="ls-glow a" />
      <span className="ls-glow b" />
      <div className="ls-floor"><div className="ls-grid" /></div>
      <div className="ls-horizon" />
      <div className="ls-shelf">
        <img src="/login-shelf.webp" alt="" width="1560" height="720" fetchpriority="high" />
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
        className="ls-up inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-brand-500 px-8 text-[15px] font-bold text-slate-950 shadow-[0_10px_30px_-10px_rgba(163,230,53,0.8)] transition active:scale-[0.98] hover:bg-brand-600 md:hidden"
      >
        Log in
        <ArrowRight className="h-4 w-4" />
      </button>

      {/* A browser tab always keeps its address bar; only an installed app is
          full screen. Nothing draws here on a computer or once it is in. */}
      <InstallButton
        render={(openSheet) => (
          <button type="button" onClick={openSheet} style={rise(0.68)}
            className="ls-up mt-3.5 inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-white/60 underline-offset-4 transition hover:text-white hover:underline md:hidden">
            <Smartphone className="h-3.5 w-3.5" />
            Get the full-screen app
          </button>
        )}
      />

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
     stays where it is while the words move over it. */
  return (
    <div className="relative isolate min-h-dvh overflow-x-hidden bg-[#070907] text-white">
      <Scene />

      <div className="relative z-10 grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* The words — a computer has a column to itself for them. */}
        <section className="hidden flex-col justify-between p-12 lg:flex">
          <div className="ls-up w-fit" style={rise(0.05)}><Mark size="lg" /></div>

          <div className="mb-[clamp(170px,30vh,320px)] max-w-lg">
            <p className="ls-up mb-5 h-1 w-12 rounded bg-brand-500" style={rise(0.18)} />
            <h2 className="ls-up text-balance text-4xl font-bold leading-[1.08] tracking-tight xl:text-5xl" style={rise(0.26)}>
              Take stock. Make moves. <span className="text-brand-500">Earn more.</span>
            </h2>
            <p className="ls-up mt-4 max-w-md text-[15px] leading-relaxed text-white/65" style={rise(0.4)}>
              Every box that leaves The Lab is on the system — who took it, what came
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
          <p className="text-xs text-white/40">The Lab · Hao Stock Management System</p>
        </section>

        {/* The way in. On a phone this column is the whole screen. */}
        {/* A phone gives the whole screen to this one column, so the brand and
            the way in sit in the middle of the air ABOVE the cartons, not at
            the top of the glass: pb-[36vh] is the room the shelf wants. */}
        <section className="flex flex-col items-center justify-center px-5 pb-[max(36vh,calc(3rem+env(safe-area-inset-bottom)))] pt-[max(1.75rem,env(safe-area-inset-top))] md:pb-[max(4rem,calc(3rem+env(safe-area-inset-bottom)))] lg:px-10 lg:py-10">
          <div className="ls-up mb-7 lg:hidden" style={rise(0.05)}><Mark /></div>

          <p className="ls-up mb-7 max-w-[15rem] text-balance text-center text-[15px] leading-snug text-white/80 md:hidden" style={rise(0.3)}>
            Take stock. Make moves. Earn more.
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
          <p className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 text-center text-xs text-white/45 lg:hidden">
            The Lab · Hao Stock Management System
          </p>
        </section>
      </div>
    </div>
  );
}
