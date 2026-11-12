/*
  SEARCHING THE AUDIT LOG BY THE WORDS ON THE SCREEN (audit 11 Nov 2026, admin-system-6).

  The log is stored as codes (LOGIN, DEACTIVATE, SalesRepresentative) and shown as sentences ("Nino signed
  in", "Nino deactivated a rep"). Searching "signed in" or "suspended" found nothing, because only the codes
  were searched. The page owns the words, so it works out here which codes a search means and sends them
  with it; the server also matches the person's name and email itself.

  `vocab` maps a code to the words shown for it (and any other words people use for it).
  A search shorter than 3 letters matches no words ("a", "in" would match nearly everything).
*/
const norm = (s) => String(s || '').toLowerCase().replace(/[-\s]+/g, ' ').trim();

export function matchingCodes(text, vocab = {}) {
  const q = norm(text);
  if (q.length < 3) return [];
  return Object.entries(vocab)
    .filter(([, words]) => norm(words).includes(q))
    .map(([code]) => code);
}
