// Writes to public.security_events through record_security_event()
// (migration 016). Needs a service-role client: no other role may execute it.
//
// Returns whether the write landed and never throws. Callers decide what a
// failed write means: an admin action that must be on the record checks the
// result and refuses to continue; a lockout notice just carries on.

// Structural type so this module does not pin a supabase-js version.
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
};

export type SecurityEvent = {
  type: string; // dotted lowercase, e.g. 'admin.invited'
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordSecurityEvent(client: RpcClient, event: SecurityEvent): Promise<boolean> {
  try {
    const { error } = await client.rpc('record_security_event', {
      p_event_type: event.type,
      p_actor_id: event.actorId ?? null,
      p_actor_email: event.actorEmail ?? null,
      p_ip: event.ip ?? null,
      p_target_id: event.targetId ?? null,
      p_detail: event.detail ?? {},
    });
    if (error) {
      console.error('[security-event] not recorded:', event.type, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[security-event] not recorded:', event.type, e instanceof Error ? e.message : e);
    return false;
  }
}
