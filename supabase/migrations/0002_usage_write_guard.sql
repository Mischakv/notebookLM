-- The usage table is the only thing enforcing the daily cap on the shared server
-- fallback key. Under the owner-only `for all` policy from 0001 a signed-in user
-- could PATCH their own counter back to zero through PostgREST and spend the
-- operator's key without limit.
--
-- So: users may read their own counter (the UI shows what is left) and nothing
-- more. The increment happens in a SECURITY DEFINER function that only ever
-- touches the caller's own row.

drop policy if exists "usage is owner-only" on public.usage;

create policy "usage is readable by its owner" on public.usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- SECURITY DEFINER, deliberately: the caller
-- must not be able to write this row directly. user_id is taken from the session,
-- never from an argument, so there is no row to point it at but your own.
create function public.record_fallback_message(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count   integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.usage (user_id, day, fallback_messages)
  values (v_user_id, current_date, 1)
  on conflict (user_id, day) do update
    set fallback_messages = public.usage.fallback_messages + 1
    where public.usage.fallback_messages < p_limit
  returning fallback_messages into v_count;

  -- No row returned means the ON CONFLICT ... WHERE guard rejected the update:
  -- the cap is already spent. Report it as such rather than as a silent no-op.
  if v_count is null then
    return -1;
  end if;

  return v_count;
end;
$$;

revoke all on function public.record_fallback_message(integer) from public;
grant execute on function public.record_fallback_message(integer) to authenticated;
