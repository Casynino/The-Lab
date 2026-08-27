-- The seeded bonus rule was three hours in the future, so no rep qualified.
--
-- The database session runs on Africa/Dar_es_Salaam, and effectiveFrom is a
-- timezone-less TIMESTAMP. Postgres therefore cast now() to local wall-clock
-- (UTC+3) on the way in, while Prisma reads the column back as UTC — putting
-- the rule three hours ahead of real time and making activeRule() find nothing.
--
-- `now() AT TIME ZONE 'UTC'` is the form that stores the true instant. Any
-- future migration writing a timezone-less timestamp must use it; a bare now()
-- silently drifts by the session offset.
UPDATE "bonus_rules"
   SET "effectiveFrom" = (now() AT TIME ZONE 'UTC')
 WHERE "effectiveFrom" > (now() AT TIME ZONE 'UTC');
