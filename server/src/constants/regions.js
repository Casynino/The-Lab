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

module.exports = { TZ_REGIONS, canonicalRegion };
