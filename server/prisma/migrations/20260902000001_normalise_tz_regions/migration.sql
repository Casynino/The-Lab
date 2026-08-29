-- Normalise the regions already recorded, so the regional report groups a
-- market as one row instead of several.
--
-- Region has been free text on warehouses, reps, customers and sales. Two
-- people typing "Dar es salaam" and "Dar es Salaam" produce two rows in
-- regionalPerformance, each showing half the real figure — which is worse than
-- no breakdown at all, because both look plausible.
--
-- Matching ignores case, spaces and punctuation, and covers the alternates in
-- everyday use (Coast for Pwani, DSM for Dar es Salaam, the English names for
-- the Zanzibar regions). Anything that matches nothing is LEFT ALONE rather
-- than guessed at: a wrong region silently distorts the report, while an
-- unmatched one is visible and can be corrected by hand.
CREATE TEMP TABLE tz_region_map (raw TEXT PRIMARY KEY, canonical TEXT NOT NULL);

INSERT INTO tz_region_map (raw, canonical) VALUES
  ('arusha','Arusha'), ('daressalaam','Dar es Salaam'), ('dsm','Dar es Salaam'),
  ('dodoma','Dodoma'), ('geita','Geita'), ('iringa','Iringa'), ('kagera','Kagera'),
  ('katavi','Katavi'), ('kigoma','Kigoma'), ('kilimanjaro','Kilimanjaro'),
  ('lindi','Lindi'), ('manyara','Manyara'), ('mara','Mara'), ('mbeya','Mbeya'),
  ('morogoro','Morogoro'), ('mtwara','Mtwara'), ('mwanza','Mwanza'),
  ('njombe','Njombe'), ('pwani','Pwani'), ('coast','Pwani'), ('rukwa','Rukwa'),
  ('ruvuma','Ruvuma'), ('shinyanga','Shinyanga'), ('simiyu','Simiyu'),
  ('singida','Singida'), ('songwe','Songwe'), ('tabora','Tabora'), ('tanga','Tanga'),
  ('kaskazinipemba','Kaskazini Pemba (Pemba North)'), ('pembanorth','Kaskazini Pemba (Pemba North)'),
  ('kaskaziniunguja','Kaskazini Unguja (Unguja North)'), ('ungujanorth','Kaskazini Unguja (Unguja North)'),
  ('kusinipemba','Kusini Pemba (Pemba South)'), ('pembasouth','Kusini Pemba (Pemba South)'),
  ('kusiniunguja','Kusini Unguja (Unguja South)'), ('ungujasouth','Kusini Unguja (Unguja South)'),
  ('mjinimagharibi','Mjini Magharibi (Urban West)'), ('urbanwest','Mjini Magharibi (Urban West)');

UPDATE "warehouses" t SET "region" = m.canonical
  FROM tz_region_map m
 WHERE t."region" IS NOT NULL
   AND lower(regexp_replace(t."region", '[^A-Za-z]', '', 'g')) = m.raw
   AND t."region" <> m.canonical;

UPDATE "sales_representatives" t SET "region" = m.canonical
  FROM tz_region_map m
 WHERE t."region" IS NOT NULL
   AND lower(regexp_replace(t."region", '[^A-Za-z]', '', 'g')) = m.raw
   AND t."region" <> m.canonical;

UPDATE "customers" t SET "region" = m.canonical
  FROM tz_region_map m
 WHERE t."region" IS NOT NULL
   AND lower(regexp_replace(t."region", '[^A-Za-z]', '', 'g')) = m.raw
   AND t."region" <> m.canonical;

UPDATE "sales" t SET "region" = m.canonical
  FROM tz_region_map m
 WHERE t."region" IS NOT NULL
   AND lower(regexp_replace(t."region", '[^A-Za-z]', '', 'g')) = m.raw
   AND t."region" <> m.canonical;
