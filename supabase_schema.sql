-- =====================================================================
--  Treningsloggbok – databaseskjema for Supabase
--  Kjør hele denne filen i Supabase: SQL Editor -> New query -> lim inn -> Run
-- =====================================================================

-- ---------- Tabeller ----------

-- Øvelser (sykling, legpress, situps, ...)
create table if not exists public.exercises (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  -- 'cardio'      = minutter (sykling, roing, jogging)
  -- 'strength'    = kg x reps x sett (legpress, nedtrekk, ...)
  -- 'bodyweight'  = reps x sett, vekt valgfri (situps, knebøy knelende, skulder, ...)
  type        text not null check (type in ('cardio', 'strength', 'bodyweight')),
  sort_order  int  not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- En økt-oppføring: én rad per øvelse per dato
create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  exercise_id   uuid not null references public.exercises (id) on delete cascade,
  performed_on  date not null default current_date,
  minutes       numeric,          -- brukes for cardio
  entertainment text,             -- "hva så du på?" – husker tidligere tekster
  notes         text,
  created_at    timestamptz not null default now(),
  unique (user_id, exercise_id, performed_on)
);

-- Økt-info per dag (energinivå/dagsform)
create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  performed_on  date not null default current_date,
  -- dagsform: 'syk' | 'slapp' | 'ok' | 'flott'
  energy        text check (energy in ('syk', 'slapp', 'ok', 'flott')),
  created_at    timestamptz not null default now(),
  unique (user_id, performed_on)
);

-- Sett for styrke/kroppsvekt-øvelser (kg x reps)
create table if not exists public.sets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entry_id    uuid not null references public.entries (id) on delete cascade,
  position    int  not null default 0,
  weight      numeric,            -- kg (kan være null for kroppsvekt)
  reps        int,
  created_at  timestamptz not null default now()
);

-- ---------- Indekser ----------
create index if not exists entries_user_date_idx   on public.entries (user_id, performed_on);
create index if not exists entries_exercise_idx    on public.entries (exercise_id, performed_on);
create index if not exists sets_entry_idx          on public.sets (entry_id);
create index if not exists exercises_user_idx      on public.exercises (user_id, sort_order);
create index if not exists sessions_user_date_idx  on public.sessions (user_id, performed_on);

-- ---------- Row Level Security ----------
-- Sørger for at hver bruker bare ser og endrer SINE EGNE data.
alter table public.exercises enable row level security;
alter table public.entries   enable row level security;
alter table public.sessions  enable row level security;
alter table public.sets      enable row level security;

drop policy if exists "egne øvelser" on public.exercises;
create policy "egne øvelser" on public.exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "egne oppføringer" on public.entries;
create policy "egne oppføringer" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "egne økter" on public.sessions;
create policy "egne økter" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "egne sett" on public.sets;
create policy "egne sett" on public.sets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Ferdig! Gå tilbake til appen og logg inn.
