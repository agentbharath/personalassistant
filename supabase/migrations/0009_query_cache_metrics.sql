alter table public.query_runs
  add column cache_hits integer not null default 0 check (cache_hits >= 0),
  add column cache_misses integer not null default 0 check (cache_misses >= 0);

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
  p_error_code text,
  p_cache_hits integer,
  p_cache_misses integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.query_runs (
    user_id, request_id, conversation_id, agents, status, outcome, duration_ms,
    reserved_cost_usd, actual_cost_usd, error_code, cache_hits, cache_misses
  ) values (
    p_user_id, p_request_id, p_conversation_id, coalesce(p_agents, '{}'), p_status,
    p_outcome, p_duration_ms, p_reserved_cost_usd, p_actual_cost_usd, p_error_code,
    greatest(coalesce(p_cache_hits, 0), 0), greatest(coalesce(p_cache_misses, 0), 0)
  )
  on conflict (request_id) do nothing;
end;
$$;

revoke all on function public.record_query_run(uuid, uuid, uuid, text[], text, text, integer, numeric, numeric, text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_query_run(uuid, uuid, uuid, text[], text, text, integer, numeric, numeric, text, integer, integer) to service_role;
