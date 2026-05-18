-- Sign2Sign — close the validate_route_code anon bypass
-- Run via: supabase db push
--
-- *** APPLY THIS ONLY AFTER ***
--   1. The validate-code Edge Function (supabase/functions/validate-code) is
--      deployed and smoke-tested.
--   2. The driver client has shipped the switch from supabase.rpc(...) to
--      fetch('/functions/v1/validate-code', ...).
--
-- Until both are true, applying this migration will break driver code entry
-- for any client still calling the RPC directly.
--
-- Effect:
--   - Anon can no longer execute validate_route_code() — the only call path
--     left is the Edge Function (which uses the service-role key internally).
--   - This closes the bypass where an attacker could rotate client_id values
--     to defeat the in-DB rate limit. After this migration, the only way to
--     reach the RPC is through the Edge Function, which adds IP-keyed
--     throttling that is much harder to rotate cheaply.

revoke execute on function public.validate_route_code(text, uuid) from anon;

-- recover_existing_photo() remains anon-callable. Switching it through the
-- Edge Function would add latency to every photo upload retry without much
-- security benefit (the function already validates the calling code owns
-- the target job).
