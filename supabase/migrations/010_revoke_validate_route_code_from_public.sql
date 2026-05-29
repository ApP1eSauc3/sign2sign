-- Sign2Sign — close the PUBLIC execute bypass on validate_route_code
-- Run via: supabase db push
--
-- Migration 008 revoked EXECUTE from anon, but Postgres grants EXECUTE to
-- PUBLIC by default on every new function. anon is a member of PUBLIC, so it
-- still inherited execute and could reach validate_route_code() directly —
-- bypassing the Edge Function's IP-keyed throttle (the in-DB per-client_id
-- limit still applied, so this was a partial weakening, not a full bypass).
--
-- Revoke the PUBLIC default so the Edge Function (service_role) is genuinely
-- the only path, as 008 intended. service_role keeps its explicit grant, so
-- the deployed validate-code function continues to work. authenticated keeps
-- its explicit grant (admins are already trusted and never call this RPC).

revoke execute on function public.validate_route_code(text, uuid) from public;
