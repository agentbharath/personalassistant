create table public.model_usage_daily (
  user_id uuid not null references auth.users(id) on delete restrict,
  usage_date date not null default current_date,
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  calls bigint not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create table public.model_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  operation text not null,
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

alter table public.model_usage_daily enable row level security;
alter table public.model_usage_events enable row level security;

create policy "users read their daily model usage" on public.model_usage_daily
  for select using (auth.uid() = user_id);
create policy "users read their model usage events" on public.model_usage_events
  for select using (auth.uid() = user_id);

create index model_usage_events_user_time_idx on public.model_usage_events (user_id, created_at desc);

create or replace function public.reserve_model_tokens(p_user_id uuid, p_tokens integer, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare allowed boolean := false;
begin
  if p_tokens <= 0 or p_daily_limit <= 0 or p_tokens > p_daily_limit then return false; end if;
  insert into public.model_usage_daily (user_id, usage_date, reserved_tokens)
  values (p_user_id, current_date, p_tokens)
  on conflict (user_id, usage_date) do update
    set reserved_tokens = model_usage_daily.reserved_tokens + excluded.reserved_tokens,
        updated_at = now()
    where model_usage_daily.reserved_tokens + excluded.reserved_tokens <= p_daily_limit
  returning true into allowed;
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.reserve_model_tokens(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_model_tokens(uuid, integer, integer) to service_role;

create or replace function public.record_model_usage(p_user_id uuid, p_request_id uuid, p_operation text, p_model text, p_input_tokens integer, p_output_tokens integer, p_duration_ms integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.model_usage_events (user_id, request_id, operation, model, input_tokens, output_tokens, duration_ms)
  values (p_user_id, p_request_id, p_operation, p_model, p_input_tokens, p_output_tokens, p_duration_ms);
  insert into public.model_usage_daily (user_id, usage_date, input_tokens, output_tokens, calls)
  values (p_user_id, current_date, p_input_tokens, p_output_tokens, 1)
  on conflict (user_id, usage_date) do update
    set input_tokens = model_usage_daily.input_tokens + excluded.input_tokens,
        output_tokens = model_usage_daily.output_tokens + excluded.output_tokens,
        calls = model_usage_daily.calls + 1,
        updated_at = now();
end;
$$;

revoke all on function public.record_model_usage(uuid, uuid, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_model_usage(uuid, uuid, text, text, integer, integer, integer) to service_role;
