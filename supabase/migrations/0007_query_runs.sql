create table public.query_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null unique,
  conversation_id uuid references public.conversations(id) on delete set null,
  agents text[] not null default '{}',
  status text not null check (status in ('completed', 'waiting_for_user', 'partially_completed', 'failed')),
  outcome text not null check (outcome in ('success', 'timeout', 'cost_limited', 'provider_error', 'internal_error')),
  duration_ms integer not null check (duration_ms >= 0),
  reserved_cost_usd numeric(10,6) not null default 0 check (reserved_cost_usd >= 0),
  actual_cost_usd numeric(10,6) not null default 0 check (actual_cost_usd >= 0),
  error_code text,
  created_at timestamptz not null default now()
);

alter table public.query_runs enable row level security;

create policy "users read their query telemetry" on public.query_runs
  for select using (auth.uid() = user_id);

create index query_runs_user_time_idx on public.query_runs (user_id, created_at desc);
create index query_runs_outcome_time_idx on public.query_runs (outcome, created_at desc);

create or replace function public.record_query_run(
  p_user_id uuid,
  p_request_id uuid,
  p_conversation_id uuid,
  p_agents text[],
  p_status text,
  p_outcome text,
  p_duration_ms integer,
  p_reserved_cost_usd numeric,
  p_actual_cost_usd numeric,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.query_runs (
    user_id, request_id, conversation_id, agents, status, outcome, duration_ms,
    reserved_cost_usd, actual_cost_usd, error_code
  ) values (
    p_user_id, p_request_id, p_conversation_id, coalesce(p_agents, '{}'), p_status,
    p_outcome, p_duration_ms, p_reserved_cost_usd, p_actual_cost_usd, p_error_code
  )
  on conflict (request_id) do nothing;
end;
$$;

revoke all on function public.record_query_run(uuid, uuid, uuid, text[], text, text, integer, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.record_query_run(uuid, uuid, uuid, text[], text, text, integer, numeric, numeric, text) to service_role;
