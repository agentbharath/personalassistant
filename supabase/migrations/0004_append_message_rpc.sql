create or replace function public.append_conversation_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_role text,
  p_content_ciphertext text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'not authorized';
  end if;
  insert into public.conversation_messages (user_id, conversation_id, role, content_ciphertext, content_summary)
  values (p_user_id, p_conversation_id, p_role, p_content_ciphertext, null);
  update public.conversations set updated_at = now()
  where id = p_conversation_id and user_id = p_user_id;
end;
$$;

revoke all on function public.append_conversation_message(uuid, uuid, text, text) from public;
grant execute on function public.append_conversation_message(uuid, uuid, text, text) to authenticated;
