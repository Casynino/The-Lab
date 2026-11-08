/**
 * Hao Labs' own colours, in one place.
 *
 * The mark is a red "hǎo" and a black word (Nino, 9 Nov 2026). Everything in
 * the interface that cannot reach a Tailwind class — a chart series, a toast
 * icon, a PDF, an inline gradient — reads its red from here, so correcting the
 * house red is one line in this file plus `brand.500` in tailwind.config.js,
 * not a hunt through thirty components.
 */

/** The mark's own red. The one value that must be exactly right. */
export const RED = '#ee3124';
/** Its r,g,b, for rgb(... / alpha) in an inline style. */
export const RED_RGB = '238, 49, 36';
/** The coral a word is written in on a near-black page — see tailwind brand.600. */
export const CORAL = '#ff5f4b';
/** The ink of the word "Labs": the page's own near-black. */
export const INK = '#0a0a0b';

/** A chart's series, starting on the house red. */
export const SERIES = [RED, '#ff8d7d', '#f59e0b', '#38bdf8', '#a855f7', '#10b981', '#ec4899', '#facc15'];

/** `rgba()` from the house red at a given alpha. */
export const redA = (a) => `rgba(${RED_RGB}, ${a})`;
