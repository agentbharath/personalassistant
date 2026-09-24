-- Retain the assistant's actual offered choices, encrypted and committed with its message.
alter table public.conversation_messages add column context_ciphertext text;
create function public.append_conversation_message_with_context(
  p_user_id uuid, p_conversation_id uuid, p_role text, p_content_ciphertext text, p_context_ciphertext text
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is distinct from p_user_id or not exists (
    select 1 from public.conversations where id = p_conversation_id and user_id = p_user_id
  ) then raise exception 'not authorized'; end if;
  insert into public.conversation_messages(user_id, conversation_id, role, content_ciphertext, context_ciphertext, content_summary)
  values(p_user_id, p_conversation_id, p_role, p_content_ciphertext, p_context_ciphertext, null);
  update public.conversations set updated_at = now() where id = p_conversation_id and user_id = p_user_id;
end;
$$;
revoke all on function public.append_conversation_message_with_context(uuid, uuid, text, text, text) from public;
grant execute on function public.append_conversation_message_with_context(uuid, uuid, text, text, text) to authenticated;
