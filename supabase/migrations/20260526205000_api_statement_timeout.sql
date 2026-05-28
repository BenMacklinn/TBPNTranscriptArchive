-- PostgREST roles default to 3-8s, which is too low once the archive grows
-- or while backfill inserts are running concurrently with search.

alter role authenticator set statement_timeout = '30s';
alter role anon set statement_timeout = '30s';
alter role authenticated set statement_timeout = '30s';
