import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useBackToClose } from '@/lib/useBackToClose';

/**
 * "How it works" — the rep guide film, on the sign-in page (Nino, 11 Nov 2026: a video a rep sees at the
 * door showing every step: log in, request, settle, wallet, withdraw, return, more time).
 *
 * The film is downloaded only when someone taps the link — a rep on mobile data who just wants to sign in
 * never pays for it — and it plays full screen over the page with its own controls and sound (a tap is the
 * gesture browsers ask for before playing sound). Escape, the X, or a tap outside the picture closes it.
 * The file is a web copy of docs/video/rep-guide (rendered with HyperFrames), kept small for phones.
 */
const SRC = '/video/rep-guide.mp4';
const POSTER = '/video/rep-guide-poster.jpg';

export default function HowItWorksVideo({ style, className }) {
  const [open, setOpen] = useState(false);
  // The phone's Back closes the film, not the sign-in page (lib/backToClose.js).
  useBackToClose(open, () => setOpen(false), { guard: false });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={style} className={className}>
        How it works
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How it works"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-[max(0.75rem,env(safe-area-inset-top))_max(0.75rem,env(safe-area-inset-right))_max(0.75rem,env(safe-area-inset-bottom))_max(0.75rem,env(safe-area-inset-left))]"
        >
          <video
            src={SRC}
            poster={POSTER}
            controls
            autoPlay
            playsInline
            preload="auto"
            className="max-h-full w-auto max-w-full rounded-2xl bg-black shadow-2xl"
            style={{ aspectRatio: '9 / 16' }}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}
