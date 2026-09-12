-- Move Make 4 data out of the generic key/value table into real tables.
--
-- The old table (kv_store_59149df1) is only read here, never changed, so the
-- copy can be checked before that table is dropped in a later migration.
--
-- Only the server edge function (service role) touches these tables. RLS is on
-- with no policies and the anon/authenticated roles get no grants, so the public
-- anon key in the browser cannot read or write them.

-- ─── Tables ───

-- One row per player name (case-insensitive).
create table public.players (
  name_key text primary key, -- lower(trim(name))
  display_name text not null, -- most recent casing
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  updated_at timestamptz not null default now()
);

-- A player's stats for one timer level (timer duration in seconds).
create table public.player_level_stats (
  name_key text not null references public.players (name_key) on delete cascade,
  level integer not null check (level > 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  primary key (name_key, level)
);

-- Token look shown next to a player on the leaderboard.
create table public.token_configs (
  name_key text primary key, -- lower(trim(name)) with [^a-z0-9_-] replaced by _
  player_name text not null,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

-- Custom token image file in the storage bucket.
create table public.token_images (
  name_key text primary key, -- same key as token_configs
  file_path text not null,
  uploaded_at timestamptz not null default now()
);

-- Online multiplayer rooms. Short-lived: expired rooms are deleted lazily.
create table public.rooms (
  code text primary key,
  host_name text not null,
  guest_name text,
  timer_duration integer not null default 40,
  blast_tokens boolean not null default true,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  created_at timestamptz not null default now(),
  joined_at timestamptz
);

-- Single-row site counters.
create table public.site_stats (
  id boolean primary key default true check (id),
  total_visits bigint not null default 0
);

insert into public.site_stats (id, total_visits) values (true, 0);

alter table public.players enable row level security;
alter table public.player_level_stats enable row level security;
alter table public.token_configs enable row level security;
alter table public.token_images enable row level security;
alter table public.rooms enable row level security;
alter table public.site_stats enable row level security;

revoke all on table
  public.players,
  public.player_level_stats,
  public.token_configs,
  public.token_images,
  public.rooms,
  public.site_stats
from anon, authenticated;

-- ─── Functions ───
-- Each one does its read-and-write in a single statement or transaction, so two
-- requests at the same moment can't overwrite each other's changes.

-- Add one game result to both players' totals (and per-level stats when timed).
create function public.record_game(
  p_player1 text,
  p_player2 text,
  p_winner text,
  p_game_mode text default null,
  p_timer_duration integer default null
)
returns setof public.players
language plpgsql
set search_path = ''
as $$
declare
  key1 constant text := lower(trim(p_player1));
  key2 constant text := lower(trim(p_player2));
  p1_win constant integer := (p_winner = 'player1')::integer;
  p2_win constant integer := (p_winner = 'player2')::integer;
  draw constant integer := (p_winner = 'draw')::integer;
begin
  if p_winner is null or p_winner not in ('player1', 'player2', 'draw') then
    raise exception 'invalid winner: %', p_winner;
  end if;

  insert into public.players as p (name_key, display_name, wins, losses, draws, games_played)
  values (key1, trim(p_player1), p1_win, p2_win, draw, 1)
  on conflict (name_key) do update set
    display_name = excluded.display_name,
    wins = p.wins + excluded.wins,
    losses = p.losses + excluded.losses,
    draws = p.draws + excluded.draws,
    games_played = p.games_played + 1,
    updated_at = now();

  -- The bot's display name is fixed by the client; keep the stored casing.
  insert into public.players as p (name_key, display_name, wins, losses, draws, games_played)
  values (key2, trim(p_player2), p2_win, p1_win, draw, 1)
  on conflict (name_key) do update set
    display_name = case when p_game_mode = 'bot' then p.display_name else excluded.display_name end,
    wins = p.wins + excluded.wins,
    losses = p.losses + excluded.losses,
    draws = p.draws + excluded.draws,
    games_played = p.games_played + 1,
    updated_at = now();

  if p_timer_duration > 0 then
    insert into public.player_level_stats as l (name_key, level, wins, losses, draws, games_played)
    values (key1, p_timer_duration, p1_win, p2_win, draw, 1)
    on conflict (name_key, level) do update set
      wins = l.wins + excluded.wins,
      losses = l.losses + excluded.losses,
      draws = l.draws + excluded.draws,
      games_played = l.games_played + 1;

    insert into public.player_level_stats as l (name_key, level, wins, losses, draws, games_played)
    values (key2, p_timer_duration, p2_win, p1_win, draw, 1)
    on conflict (name_key, level) do update set
      wins = l.wins + excluded.wins,
      losses = l.losses + excluded.losses,
      draws = l.draws + excluded.draws,
      games_played = l.games_played + 1;
  end if;

  return query select * from public.players where name_key in (key1, key2);
end;
$$;

-- Ranked leaderboard: the top p_limit rows, plus p_player's row wherever it ranks.
-- p_level null = all games; otherwise only games played at that timer level.
create function public.get_leaderboard(
  p_limit integer,
  p_level integer default null,
  p_player text default null
)
returns table (
  rank bigint,
  name_key text,
  display_name text,
  wins integer,
  losses integer,
  draws integer,
  games_played integer
)
language sql
stable
set search_path = ''
as $$
  with stats as (
    select p.name_key, p.display_name, p.wins, p.losses, p.draws, p.games_played
    from public.players p
    where p_level is null
    union all
    select p.name_key, p.display_name, l.wins, l.losses, l.draws, l.games_played
    from public.player_level_stats l
    join public.players p on p.name_key = l.name_key
    where l.level = p_level
  ),
  ranked as (
    select
      row_number() over (
        order by s.wins desc, s.wins::numeric / s.games_played desc, s.name_key
      ) as rank,
      s.*
    from stats s
    where s.games_played > 0
  )
  select r.rank, r.name_key, r.display_name, r.wins, r.losses, r.draws, r.games_played
  from ranked r
  where r.rank <= p_limit or r.name_key = lower(trim(p_player))
  order by r.rank;
$$;

-- Player counts for the site stats panel. Each game adds to two players.
create function public.player_totals()
returns table (total_players bigint, total_games bigint)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where games_played > 0),
    coalesce(sum(games_played), 0) / 2
  from public.players;
$$;

create function public.record_visit()
returns bigint
language sql
set search_path = ''
as $$
  update public.site_stats
  set total_visits = total_visits + 1
  where id
  returning total_visits;
$$;

-- Create a room with a fresh 6-character code, unless the room cap is reached.
-- Raises 'room_capacity_reached' when full.
create function public.create_room(
  p_host_name text,
  p_timer_duration integer,
  p_blast_tokens boolean,
  p_max_rooms integer,
  p_ttl_seconds integer
)
returns public.rooms
language plpgsql
set search_path = ''
as $$
declare
  code_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no ambiguous chars
  new_code text;
  new_room public.rooms;
begin
  -- One room creation at a time, so racing requests can't pass the cap.
  perform pg_advisory_xact_lock(hashtext('make4.create_room'));

  delete from public.rooms where created_at < now() - make_interval(secs => p_ttl_seconds);

  if (select count(*) from public.rooms) >= p_max_rooms then
    raise exception 'room_capacity_reached';
  end if;

  for attempt in 1..10 loop
    select string_agg(substr(code_chars, 1 + floor(random() * length(code_chars))::integer, 1), '')
    into new_code
    from generate_series(1, 6);

    begin
      insert into public.rooms (code, host_name, timer_duration, blast_tokens)
      values (new_code, trim(p_host_name), p_timer_duration, p_blast_tokens)
      returning * into new_room;
      return new_room;
    exception when unique_violation then
      -- Code already taken; try another.
    end;
  end loop;

  raise exception 'could not generate a unique room code';
end;
$$;

revoke execute on function
  public.record_game(text, text, text, text, integer),
  public.get_leaderboard(integer, integer, text),
  public.player_totals(),
  public.record_visit(),
  public.create_room(text, integer, boolean, integer, integer)
from public, anon, authenticated;

-- ─── Copy existing data from the key/value table ───
-- Rooms are not copied: they expire after 30 minutes anyway.

do $$
begin
  if to_regclass('public.kv_store_59149df1') is null then
    return;
  end if;

  -- key 'player:<name_key>'
  insert into public.players (name_key, display_name, wins, losses, draws, games_played)
  select
    substr(key, 8),
    coalesce(nullif(trim(value ->> 'name'), ''), substr(key, 8)),
    coalesce((value ->> 'wins')::integer, 0),
    coalesce((value ->> 'losses')::integer, 0),
    coalesce((value ->> 'draws')::integer, 0),
    coalesce((value ->> 'gamesPlayed')::integer, 0)
  from public.kv_store_59149df1
  where key like 'player:%';

  -- value.byLevel = { "<level>": { wins, losses, draws, gamesPlayed } }
  insert into public.player_level_stats (name_key, level, wins, losses, draws, games_played)
  select
    substr(kv.key, 8),
    lvl.key::integer,
    coalesce((lvl.value ->> 'wins')::integer, 0),
    coalesce((lvl.value ->> 'losses')::integer, 0),
    coalesce((lvl.value ->> 'draws')::integer, 0),
    coalesce((lvl.value ->> 'gamesPlayed')::integer, 0)
  from public.kv_store_59149df1 kv
  cross join lateral jsonb_each(
    case when jsonb_typeof(kv.value -> 'byLevel') = 'object' then kv.value -> 'byLevel' else '{}'::jsonb end
  ) lvl
  where kv.key like 'player:%'
    and lvl.key ~ '^[1-9][0-9]*$';

  -- key 'tokenconfig:<name_key>', value = config + playerName + updatedAt
  insert into public.token_configs (name_key, player_name, config, updated_at)
  select
    substr(key, 13),
    coalesce(value ->> 'playerName', substr(key, 13)),
    value - 'playerName' - 'updatedAt',
    coalesce((value ->> 'updatedAt')::timestamptz, now())
  from public.kv_store_59149df1
  where key like 'tokenconfig:%';

  -- key 'token:<name_key>', value = { filePath, uploadedAt, ... }
  insert into public.token_images (name_key, file_path, uploaded_at)
  select
    substr(key, 7),
    value ->> 'filePath',
    coalesce((value ->> 'uploadedAt')::timestamptz, now())
  from public.kv_store_59149df1
  where key like 'token:%'
    and value ->> 'filePath' is not null;

  update public.site_stats
  set total_visits = coalesce(
    (select (value ->> 'totalVisits')::bigint from public.kv_store_59149df1 where key = 'site:stats'),
    0
  )
  where id;
end;
$$;
