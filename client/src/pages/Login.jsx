import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, Eye, EyeOff, ArrowRight, ArrowUpRight, Smartphone, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Field, Input } from '@/components/ui';
import { InstallButton } from '@/components/InstallApp';
import { idle, IDLE_LIMIT_MINUTES } from '@/lib/idle';
import './login.css';

/**
 * The sign-in screen.
 *
 * Nino, 9 Nov 2026, holding up Super Drive's: one full screen with the brand
 * on it, the product standing in it, and ONE button, so the scene is never
 * buried under a form. Pressing it opens the form as a pop-up. Since 10 Nov
 * that is true on a computer too — he did not like the words column and the
 * card beside it: "on the PC I should just see the log in, and when I tap it
 * I get a nice pop-up, just like on the phone".
 *
 * What used to be here was a tall marketing page: hero, four counters, four
 * perk cards, a credit line. On a phone that is four screens of scrolling
 * before the password field, and none of it is read twice.
 */

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Ask the browser to keep this password (Nino, 10 Nov 2026: "make sure they
 * save their password, so next time they can log in fast").
 *
 * Browsers offer to save on their own when a form is submitted and goes away,
 * but a sign-in that never reloads the page — this one, a single-page app — is
 * the case where Chrome's guess fails, most of all when the person had pressed
 * the eye to look at what they typed (the box is then plain text). Chrome,
 * Edge and Samsung Internet (the phones reps carry) have a call for exactly
 * this; Safari and Firefox ignore it and use the form's own autocomplete
 * attributes, which are set on the fields below. The person still chooses:
 * the browser asks, it is never saved silently.
 */
function offerToSave(email, password, name) {
  try {
    if ('PasswordCredential' in window && navigator.credentials?.store) {
      navigator.credentials.store(new window.PasswordCredential({ id: email, password, name })).catch(() => {});
    }
  } catch { /* no password manager here: the form's own attributes still work */ }
}

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
      className={`w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)] ${big ? 'h-11 sm:h-14 lg:h-[3.75rem]' : 'h-14 sm:h-16'}`}
    />
  );
}

// ── The scene ────────────────────────────────────────────────────────────────

/* Nino, 10 Nov 2026: "I want the WHOLE page designed… a very animated,
   video-like, moving, realistic scene: show the map, show the road, show the
   bike… take Bongo Life as the example." So the page is one picture that
   moves: Hao Labs' own corner of Tanzania, rendered in 3D by
   docs/mockups/world.py — the Lab on the Dar coast with a lorry at the bay,
   the forklift and the people loading it, the port beside it with its crane
   and the ships coming and going, Kariakoo market with its arches and
   umbrellas and crowd (he sent three paintings of it), the city's streets,
   the road running inland with the lorries, daladalas and bikes on it, and
   the cargo plane overhead. No place names and no billboards — he found the
   pins forced and the brand must not be shouted; instead the products ride
   on the stock itself: OHIS, Civlily and Pepa cartons, master cartons and
   inner boxes, on the pallets, the forklift, the racking, in people's hands,
   on the bike, outside every depot and on the market stalls.

   240 frames, a 24-second loop, as an animated WebP — the site he pointed at
   plays a 5.6 MB MP4, and there is no ffmpeg on this machine to cut one; the
   frames are kept (--dump) so there can be one later. Two films, one per way
   of holding the phone, and the browser picks by orientation. The poster (one
   frame, a few dozen KB) is on screen at once; the film fades in over it when
   it has arrived, so nobody waits in the dark. */

const FILM = {
  poster: { portrait: '/scene/portrait-poster.webp', landscape: '/scene/landscape-poster.webp' },
  film: { portrait: '/scene/portrait.webp', landscape: '/scene/landscape.webp' },
};

function Film({ kind, className, onLoad }) {
  return (
    <picture className={className}>
      <source media="(orientation: portrait)" srcSet={FILM[kind].portrait} />
      <img src={FILM[kind].landscape} alt="" width="1600" height="900" decoding="async"
        fetchpriority={kind === 'poster' ? 'high' : undefined} onLoad={onLoad} />
    </picture>
  );
}

function Scene() {
  const [ready, setReady] = useState(false);
  const still = useReducedMotion();
  return (
    <div className="ls" aria-hidden="true">
      <Film kind="poster" className="ls-film" />
      {/* Somebody who has asked their phone to stop moving things gets the
          poster alone — it is a picture, not information. */}
      {!still && <Film kind="film" className={`ls-film ls-moving${ready ? ' is-ready' : ''}`} onLoad={() => setReady(true)} />}
      <div className="ls-vignette" />
    </div>
  );
}

// ── The pop-up ───────────────────────────────────────────────────────────────

/**
 * The form must not cover the scene: the page shows one button, and pressing
 * it opens the card over a dimmed screen (Escape, the X, or a tap outside
 * closes it) — on a phone and on a computer alike.
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
        className="ls-up inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-brand-500 px-7 text-sm font-semibold text-white transition active:scale-[0.98] hover:bg-brand-600 md:h-12 md:px-9 md:text-[15px]"
      >
        Log in
        <ArrowRight className="h-3.5 w-3.5" />
      </button>

      {/* The way to the full-screen app, for a phone that has not installed
          it yet (owner, 9 Nov 2026 — taken off, then asked for back the same
          night: a rep arriving at the door should be able to get the app
          from here). The sheet also offers itself once after sign-in. Draws
          nothing on a computer or once the app is installed. */}
      <InstallButton
        render={(openSheet) => (
          <button type="button" onClick={openSheet} style={rise(0.68)}
            className="ls-up mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-white/55 underline-offset-4 transition hover:text-white hover:underline">
            <Smartphone className="h-3 w-3" />
            Get the full-screen app
          </button>
        )}
      />

      <div
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        className={open
          ? 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#040605]/60 p-5 pt-[13vh] backdrop-blur-sm md:items-center md:pt-5'
          : 'hidden'}
      >
        <div className="ls-pop relative w-full max-w-sm">
          {children}
          {open && (
            <button type="button" onClick={() => setOpen(false)} aria-label="Close"
              className="absolute right-3 top-3 grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-elevated hover:text-foreground">
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
 * page of my projects". That page is /nino. On 10 Nov he changed the words:
 * the line reads "The Distribution Chain by Nino", not "Developed by Nino".
 */
function Credit() {
  return (
    <Link to="/nino" className="group inline-flex items-center gap-1 text-white/45 transition-colors hover:text-white">
      by <span className="font-semibold text-white/75 transition-colors group-hover:text-brand-500">Nino</span>
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

  // Signed out for not using it? Say so, once — otherwise a rep who comes back
  // to a sign-in screen thinks something broke.
  useEffect(() => {
    if (idle.takeNotice()) {
      toast(`You were signed out because the system was not used for ${IDLE_LIMIT_MINUTES} minutes. Log in to continue.`, { duration: 9000 });
    }
  }, []);

  if (!loading && isAuthenticated) return <Navigate to={from} replace />;

  const onSubmit = async (values) => {
    const res = await login(values.email, values.password);
    if (res.ok) {
      offerToSave(values.email, values.password, res.user.name);
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

      {/* One centred column at every size: the brand, one line, one button.
          The Lab, the port and the sea fill the rest of the glass, so the
          sections are as short as the words need and the room under them is
          the picture's. */}
      <div className="relative z-10 flex min-h-dvh flex-col">
        <section className="flex flex-1 flex-col items-center justify-start px-5 pb-16 pt-[max(calc(env(safe-area-inset-top)+1.5rem),10vh)] md:pt-[6vh]">
          <div className="ls-up mb-4 md:mb-5" style={rise(0.05)}><Mark size="lg" /></div>

          <p className="ls-up mb-3.5 hidden h-[3px] w-10 rounded bg-brand-500 md:block" style={rise(0.18)} />
          <h2 className="ls-up mb-5 max-w-[15rem] text-balance text-center text-[13.5px] leading-snug tracking-[0.01em] text-white/75 md:mb-6 md:max-w-none md:whitespace-nowrap md:text-[1.7rem] md:font-semibold md:leading-[1.15] md:tracking-tight md:text-white lg:text-[2rem]" style={rise(0.3)}>
            We keep Tanzania <span className="md:text-brand-500">stocked.</span>
          </h2>

          <Gate>
            <div className="ls-up card w-full border-white/10 bg-surface/85 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:p-7" style={rise(0.22)}>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Log in</h1>
              <p className="mt-1 text-sm text-muted">Enter your details to start working.</p>

              <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
                <Field label="Email" error={errors.email?.message} required>
                  <Input id="login-email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@thelab.co.tz" {...register('email')} />
                </Field>
                <Field label="Password" error={errors.password?.message} required>
                  <div className="relative">
                    <Input id="login-password" type={showPwd ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="••••••••" {...register('password')} />
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

          {/* Pinned to the foot of the screen — "The Distribution Chain by
              Nino", not the company's name again and not "Developed by"
              (Nino, 10 Nov 2026) — so it never prints itself across a carton. */}
          <p className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-4 text-center text-xs text-white/45">
            <span>The Distribution Chain</span>
            <Credit />
          </p>
        </section>
      </div>
    </div>
  );
}
