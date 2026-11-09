import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { flushSync } from 'react-dom';
import { useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, Eye, EyeOff, ArrowRight, ArrowUpRight, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui';
import { InstallButton } from '@/components/InstallApp';
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

/* A field on the glass card: 40px tall, a faint fill, a hairline, no red ring
   (the input's own 16px text is kept — below that an iPhone zooms the page). */
const FIELD = '!h-10 !rounded-xl !border-white/10 !bg-white/[0.06] !py-0 !shadow-none placeholder:text-white/25 focus:!border-white/30 focus:!ring-0';

/** The delay before a thing rises into place. */
const rise = (s) => ({ '--rd': `${s}s` });

/** The place of a line in the form's rise-in: each is a beat after the last. */
const stagger = (n) => ({ '--i': n });

// ── The mark ─────────────────────────────────────────────────────────────────

/**
 * ZELab's lockup — the old hǎo Labs logo in the same style and colours, renamed
 * (Nino, 10 Nov 2026): a red "ZE" where the red hǎo stood, and "Lab" in Nino's own
 * lettering with a tone mark on its "a". Built by docs/mockups/brand.py. (It was a
 * drawn cube in a tile before that, which is a picture of a box, not a logo.)
 */
function Mark({ size = 'md' }) {
  const big = size === 'lg';
  return (
    <img
      src="/brand/zelab-dark.png"
      alt="ZELab"
      width="911"
      height="320"
      className={`w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)] ${big ? 'h-12 sm:h-16 lg:h-[4.25rem]' : 'h-16 sm:h-[4.5rem]'}`}
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
  const [closing, setClosing] = useState(false);
  const timer = useRef(0);

  /* Closing is a short fade (160 ms), not a cut. The card stays mounted the
     whole time — the form, and what the browser has filled into it, must
     survive a close and an open. */
  const close = useCallback(() => {
    setClosing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setOpen(false); setClosing(false); }, 160);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /* Open the card AND put the cursor in the email box, in the same tap. That is
     what makes the phone offer the saved login straight away — the suggestion
     appears when a field is focused, so a card that opens with nothing selected
     makes the person tap again first (Nino, 10 Nov 2026: with a saved password,
     signing in "should just be easy, like normal"). It has to happen inside the
     tap: iOS only raises the keyboard, and the saved-login bar above it, for a
     focus made by the person's own touch — so the card is put on screen
     synchronously (flushSync) and focused before the tap is over. */
  const openGate = () => {
    window.clearTimeout(timer.current);
    setClosing(false);
    flushSync(() => setOpen(true));
    document.getElementById('login-email')?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={openGate}
        style={rise(0.5)}
        className="ls-up group inline-flex h-10 cursor-pointer items-center rounded px-2 text-[15px] font-semibold tracking-[0.02em] text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60 md:h-11 md:text-base"
      >
        {/* No pill, no glow (Nino, 10 Nov 2026, four times). The words and the
            arrow are ONE pair, centred as one, with one thin red line under
            the pair — not under the words alone, which left the arrow hanging
            outside it and the whole thing looking off-centre. */}
        <span className="relative inline-flex items-center gap-2 pb-1.5">
          Log in
          <ArrowRight className="h-3.5 w-3.5 text-white/80 transition-transform duration-200 group-hover:translate-x-0.5" />
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-brand-500 transition-colors duration-200 group-hover:bg-white" />
        </span>
      </button>

      {/* The way to the full-screen app, for a phone that has not installed
          it yet (owner, 9 Nov 2026 — taken off, then asked for back the same
          night: a rep arriving at the door should be able to get the app
          from here). The sheet also offers itself once after sign-in. Draws
          nothing on a computer or once the app is installed. */}
      <InstallButton
        render={(openSheet) => (
          <button type="button" onClick={openSheet} style={rise(0.68)}
            className="ls-up inline-flex h-8 cursor-pointer items-center px-2 text-[11.5px] tracking-[0.01em] text-white/50 underline-offset-4 transition hover:text-white hover:underline">
            Get the full-screen app
          </button>
        )}
      />

      <div
        onClick={(e) => e.target === e.currentTarget && close()}
        className={open
          ? `ls-gate fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-5 pt-[max(calc(env(safe-area-inset-top)+3rem),21vh)] md:items-center md:pt-5${closing ? ' is-closing' : ''}`
          : 'hidden'}
      >
        <div className="ls-pop relative w-full max-w-[19.5rem]">
          {children}
          {open && (
            <button type="button" onClick={close} aria-label="Close"
              className="ls-card-x absolute right-2.5 top-2.5 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80">
              <X className="h-3.5 w-3.5" />
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

  if (!loading && isAuthenticated) return <Navigate to={from} replace />;

  const onSubmit = async (values) => {
    const res = await login(values.email, values.password);
    if (res.ok) {
      offerToSave(values.email, values.password, res.user.name);
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
          ZELab, the port and the sea fill the rest of the glass, so the
          sections are as short as the words need and the room under them is
          the picture's. */}
      <div className="relative z-10 flex min-h-dvh flex-col">
        <section className="flex flex-1 flex-col items-center justify-start px-5 pb-16 pt-[max(10vh,calc(env(safe-area-inset-top)_+_7vh))] md:pt-[6vh]">
          <div className="ls-up mb-4 md:mb-5" style={rise(0.05)}><Mark size="lg" /></div>

          <p className="ls-up mb-3.5 hidden h-[3px] w-10 rounded bg-brand-500 md:block" style={rise(0.18)} />
          <h2 className="ls-up mb-3 max-w-[15rem] text-balance text-center text-[13.5px] leading-snug tracking-[0.01em] text-white/75 md:mb-6 md:max-w-none md:whitespace-nowrap md:text-[1.7rem] md:font-semibold md:leading-[1.15] md:tracking-tight md:text-white lg:text-[2rem]" style={rise(0.3)}>
            We keep Tanzania <span className="md:text-brand-500">stocked.</span>
          </h2>

          <Gate>
            {/* The same frosted glass as the install card (Nino, 10 Nov 2026, on
                the installed app: the form "looks big and bad, it should match
                the clean design"): see-through, warm, a title and two fields and
                one button. No subtitle, no red asterisks, labels you can tap. */}
            <div className="ls-card w-full rounded-2xl border border-white/[0.09] bg-[#140b0b]/72 px-4 pb-4 pt-3.5 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.75)] backdrop-blur-2xl backdrop-saturate-150">
              <h1 className="ls-field text-[15px] font-medium tracking-tight text-white" style={stagger(0)}>Log in</h1>

              <form onSubmit={handleSubmit(onSubmit)} className="mt-3.5 space-y-3">
                <div className="ls-field" style={stagger(1)}>
                  <label htmlFor="login-email" className="mb-1 block text-[12px] text-white/50">Email</label>
                  <Input id="login-email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@thelab.co.tz"
                    className={FIELD} {...register('email')} />
                  {errors.email && <p className="mt-1 text-[11.5px] text-rose-400">{errors.email.message}</p>}
                </div>
                <div className="ls-field" style={stagger(2)}>
                  <label htmlFor="login-password" className="mb-1 block text-[12px] text-white/50">Password</label>
                  <div className="relative">
                    <Input id="login-password" type={showPwd ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="••••••••"
                      className={`${FIELD} !pr-10`} {...register('password')} />
                    <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-white/35 transition hover:text-white/70">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="mt-1 text-[11.5px] text-rose-400">{errors.password.message}</p>}
                </div>
                <button type="submit" disabled={isSubmitting} style={stagger(3)} className="ls-field btn-primary !mt-4 w-full !rounded-xl !py-0 h-10 text-[14px] transition-transform active:scale-[0.985]">
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Log in <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>
              {/* There is no "forgot password" page: the administrator sets a new
                  one on the Users screen. So say that, and say it once, small. */}
              <p className="ls-field mt-3 text-center text-[11.5px] leading-snug text-white/40" style={stagger(4)}>
                Forgot your password? Ask your admin.
              </p>
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
