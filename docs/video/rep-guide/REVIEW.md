# Review — ZELab rep guide (11 Nov 2026)

## Creative calls
- Built storyline A, "One order, start to finish" (STORYLINES.md). Not built: B "Juma's week" (time-stamped
  days) and C "The box's journey" (one box flies from the Lab to the shop and the money flies back).
- Portrait 1080x1920, 51.5 s: reps watch it on phones, on the sign-in page.
- The Lab world from the sign-in film opens the film and shrinks into the phone's screen, so the video
  begins where the sign-in page already is.
- Every screen is the real app, captured at phone size with SAMPLE data on a laptop (rep "Juma Hassan",
  order STL-20261111-0003, sample prices). Nothing came from the live system, and nobody signed in to it.
  Commission per box (OHIS 5,000, Civlily 3,500) and the TSh 250,000 withdrawal minimum match the live
  Rules page; the 72 h / 96 h / 24 h rules match the server code.
- One rolling chapter word (Log in, Request, Approved, Settle, Wallet, Withdraw, Return, More time) and
  one short line each; one red word per line. Parts of a screen are "lifted" out of the glass so the
  number that matters is readable on a phone.

## Measured vs looked at
- `hyperframes check`: passes (0 errors).
- Looked at: snapshots across every chapter, the phone-width review sheet, the seams world->phone and
  phone->claim. Fixed: a lift that cut "Deposited" in half, the payoff card running into the title line,
  a stray space before a comma, and the claim overlapping the phone's exit.
- Sound (updated 11 Nov): a music bed generated on this Mac with MusicGen (facebook/musicgen-small, free,
  no account) from the prompt "calm modern uplifting instrumental, warm marimba melody, soft synth pads,
  light afro house percussion, smooth groove, 104 bpm", looped on a 12-bar boundary (103.4 BPM) with a
  1.5 s fade in and 3 s fade out; a soft "tok" (cut from the bundled pop) on every tap, a whoosh on each
  chapter roll and big lift, a pop on "Request sent" and the approval, a riser into the payoff and one bass
  hit on it. Mix measured: -16.3 LUFS, -1.1 dBTP, no clipping, taps 5-14 dB over the bed. Measured, not
  heard — the music must be listened to by a person.
- Intro (updated 11 Nov): 3.5 s of the ZELab mark and "We keep Tanzania stocked." over the sign-in page's
  moving Lab film (converted from the animated WebP to world.mp4), which carries on, unbroken, into the
  hook and shrinks into the phone.

## Weakest shot
- 43.6–44.0: a short empty beat between the phone leaving and the claim. It reads as a breath; with more
  time it could carry the phone's last frame into the first word.

## Warnings kept
- `timeline_track_too_dense` (19 screens on one track in story.html): the screens are one continuous
  phone; splitting them into sub-compositions would only make the taps harder to keep on time.
- `duplicate_media_discovery_risk`: two screens reuse a picture at different times (the order screen is
  shown twice on purpose); frames render correctly.
- `first_frame_empty` points at the sky behind the scenes; frame 0 shows the Lab world.

## How it is built
The HTML in index.html and compositions/ was generated from one table of screens, taps (centres measured
on the real buttons), lifts and chapters. Edit the HTML directly, or ask to regenerate.
