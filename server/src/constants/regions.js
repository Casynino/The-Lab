'use strict';

// The 31 regions of Tanzania — 26 on the mainland plus 5 in Zanzibar — spelled
// as the government spells them. Region is typed once on a person and then
// grouped forever in the regional performance report, so "Dar es salaam" and
// "Dar es Salaam" typed by two different people would split one market into two
// rows and quietly understate both. One list, picked from, never typed.
//
// Songwe was split from Mbeya in 2016 and is included. Zanzibar's five carry
// their Swahili names with the English in brackets, because both are in use.
const TZ_REGIONS = [
  'Arusha',
  'Dar es Salaam',
  'Dodoma',
  'Geita',
  'Iringa',
  'Kagera',
  'Katavi',
  'Kigoma',
  'Kilimanjaro',
  'Lindi',
  'Manyara',
  'Mara',
  'Mbeya',
  'Morogoro',
  'Mtwara',
  'Mwanza',
  'Njombe',
  'Pwani',
  'Rukwa',
  'Ruvuma',
  'Shinyanga',
  'Simiyu',
  'Singida',
  'Songwe',
  'Tabora',
  'Tanga',
  'Kaskazini Pemba (Pemba North)',
  'Kaskazini Unguja (Unguja North)',
  'Kusini Pemba (Pemba South)',
  'Kusini Unguja (Unguja South)',
  'Mjini Magharibi (Urban West)',
];

// Match what someone typed to the canonical spelling: case, spacing and
// punctuation are ignored, and the common English/Swahili alternates are
// accepted. Returns null when there is no confident match, so a stray value is
// never silently filed under the wrong region.
const ALIASES = {
  dares: 'Dar es Salaam',
  daressalaam: 'Dar es Salaam',
  dsm: 'Dar es Salaam',
  coast: 'Pwani',
  pembanorth: 'Kaskazini Pemba (Pemba North)',
  pembasouth: 'Kusini Pemba (Pemba South)',
  ungujanorth: 'Kaskazini Unguja (Unguja North)',
  ungujasouth: 'Kusini Unguja (Unguja South)',
  zanzibarnorth: 'Kaskazini Unguja (Unguja North)',
  zanzibarsouth: 'Kusini Unguja (Unguja South)',
  urbanwest: 'Mjini Magharibi (Urban West)',
  mjinimagharibi: 'Mjini Magharibi (Urban West)',
};

const key = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function canonicalRegion(input) {
  const k = key(input);
  if (!k) return null;
  const exact = TZ_REGIONS.find((r) => key(r) === k);
  if (exact) return exact;
  if (ALIASES[k]) return ALIASES[k];
  // A bracketed name typed without its bracket, e.g. "Pemba North".
  const partial = TZ_REGIONS.find((r) => key(r).includes(k) && k.length >= 4);
  return partial || null;
}

// The warehouse is in Dar es Salaam, so everything that comes straight out of it
// — a direct sale from the admin, stock held there, any sale that never got a
// region — is Dar es Salaam's (owner, 10 Nov 2026: the "Unassigned" slice "all
// belongs to Dar es Salaam"). Used as the answer wherever a region would
// otherwise be blank, so no report shows "Unassigned" for it.
const DEFAULT_REGION = 'Dar es Salaam';

// A list of regions as typed or sent, made clean: each one in its official
// spelling, anything unrecognisable dropped, repeats dropped, order kept.
function cleanRegions(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const c = canonicalRegion(v);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// Every region a rep works, main one first. A rep from before the list existed
// has only the single `region`, and reads as [region] — nothing was copied or
// rewritten in the database to make that so.
function repRegions(rep) {
  if (!rep) return [];
  const list = cleanRegions(rep.regions);
  if (list.length) return list;
  const one = rep.region ? canonicalRegion(rep.region) : null;
  return one ? [one] : [];
}

// What to write when a request carries a rep's region(s). `regions` wins; a
// request with only the old single `region` (an older screen) still works and
// becomes a list of one. The single `region` is always the first of the list —
// the main region that sale attribution and the regional report read. Returns
// {} when the request says nothing about regions, so an edit of a phone number
// leaves them alone.
function regionWrite(body) {
  if (!body) return {};
  const hasList = Object.prototype.hasOwnProperty.call(body, 'regions') && body.regions !== undefined;
  const hasOne = Object.prototype.hasOwnProperty.call(body, 'region') && body.region !== undefined;
  if (!hasList && !hasOne) return {};
  const list = hasList ? cleanRegions(body.regions) : cleanRegions([body.region]);
  return { regions: list, region: list[0] || null };
}

// A `where` that finds sales of one region. For Dar es Salaam it also finds the
// sales with no region at all, which are Dar es Salaam's too (see above).
function regionWhere(region) {
  if (!region) return null;
  return region === DEFAULT_REGION
    ? { OR: [{ region: DEFAULT_REGION }, { region: null }] }
    : { region };
}

// Revenue rows grouped by the region stored on the sale, as [{ region, total }],
// turned into chart slices [{ name, value }]. A sale with no region is Dar es
// Salaam's, so the blank rows and the ones already marked Dar es Salaam are the
// same market and are ADDED, not shown as two slices.
function mergeRegionRevenue(rows) {
  const byName = new Map();
  for (const r of rows || []) {
    const name = r.region || DEFAULT_REGION;
    byName.set(name, (byName.get(name) || 0) + Number(r.total || 0));
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

// The city a stock request is for (Nino, 11 Nov 2026: "when the rep has two cities, every time he requests
// stock he picks which city — from the cities he is registered to"; then: "the rep with one city should see
// it too, as the default, without picking"). A rep with ONE region gets that one, whatever was sent; a rep
// with two or more must name one of HIS; a rep with none (an old record — Dar es Salaam by default) stores
// nothing. Returns { region } or { error }.
function requestRegion(rep, asked) {
  const mine = repRegions(rep);
  if (mine.length === 0) return { region: null };
  if (mine.length === 1) return { region: mine[0] };
  const picked = asked ? canonicalRegion(asked) : null;
  if (!picked) return { error: 'Pick the city this stock is for.' };
  if (!mine.includes(picked)) return { error: `${picked} is not one of your cities.` };
  return { region: picked };
}

module.exports = { TZ_REGIONS, canonicalRegion, DEFAULT_REGION, cleanRegions, repRegions, regionWrite, regionWhere, mergeRegionRevenue, requestRegion };
