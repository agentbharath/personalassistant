create table public.financial_request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (user_id, scope)
);
alter table public.financial_request_limits enable row level security;
revoke all on public.financial_request_limits from anon, authenticated;
grant all on public.financial_request_limits to service_role;
create function public.take_financial_request(p_user_id uuid, p_scope text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare seconds integer; ceiling integer; used integer; boundary timestamptz;
begin
  case p_scope
    when 'read' then seconds := 60; ceiling := 60;
    when 'write' then seconds := 60; ceiling := 20;
    when 'link' then seconds := 600; ceiling := 5;
    when 'export' then seconds := 600; ceiling := 2;
    else raise exception 'INVALID_SCOPE';
  end case;
  boundary := to_timestamp(floor(extract(epoch from clock_timestamp()) / seconds) * seconds);
  insert into public.financial_request_limits as limits(user_id, scope, window_start, hits)
    values(p_user_id, p_scope, boundary, 1)
  on conflict(user_id, scope) do update set window_start = excluded.window_start,
    hits = case when limits.window_start = excluded.window_start then least(limits.hits + 1, ceiling + 1) else 1 end
  returning hits into used;
  return used <= ceiling;
end;
$$;
revoke all on function public.take_financial_request(uuid, text) from public, anon, authenticated;
grant execute on function public.take_financial_request(uuid, text) to service_role;
