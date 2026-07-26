-- 0002_harden_functions.sql
-- Address security advisories on the Phase 0 functions:
--   1. set_updated_at() had a mutable search_path (add a fixed one).
--   2. handle_new_user() is SECURITY DEFINER and was EXECUTE-able by anon /
--      authenticated via /rest/v1/rpc — it must only ever run from the
--      on_auth_user_created trigger, never be called directly. Revoke EXECUTE.

-- 1. Pin search_path on set_updated_at (matches the pattern used on handle_new_user).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Lock down the signup trigger function so it can't be invoked as an RPC.
--    The trigger still fires as table owner; only direct client calls are blocked.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
