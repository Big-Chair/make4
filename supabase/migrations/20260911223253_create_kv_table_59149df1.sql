-- Figma Make key/value table, already applied on the live project under this
-- version. Recreated here so local databases match the live migration history.
-- Replaced by real tables in 20260912000000_kv_to_tables.sql.

create table public.kv_store_59149df1 (
  key text not null primary key,
  value jsonb not null
);

alter table public.kv_store_59149df1 enable row level security;
