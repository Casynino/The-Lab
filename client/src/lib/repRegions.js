/*
  A rep's regions, for the screen.

  The API sends `regions` (every region the rep works, the main one first) and
  `region` (that main one). A rep from before the list existed has only
  `region`, and reads as a list of one — the same rule as repRegions() in
  server/src/constants/regions.js. (client/src/lib/regions.js is a generated
  copy of the region LIST and must not be edited by hand, so this lives here.)
*/

export function repRegions(rep) {
  if (!rep) return [];
  if (Array.isArray(rep.regions) && rep.regions.length) return rep.regions;
  return rep.region ? [rep.region] : [];
}

/** "Kaskazini Pemba (Pemba North)" → "Kaskazini Pemba": the bracket is for forms, not for sentences. */
export const shortRegion = (r) => String(r || '').replace(/\s*\(.*\)\s*$/, '').trim();

/** ["Arusha"] → "Arusha"; two → "Arusha and Mwanza"; three → "Arusha, Mwanza and Dodoma". */
export function sayRegions(list) {
  const names = (list || []).map(shortRegion).filter(Boolean);
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
