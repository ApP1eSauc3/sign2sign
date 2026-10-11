// The caller's IP as forwarded by the Supabase API gateway, or null.
//
// x-forwarded-for is "client, proxy1, proxy2"; the first entry is the client.
// The value goes into a Postgres `inet` column, and a malformed string there
// would fail the whole RPC, so anything that is not a plain IPv4 or IPv6
// address becomes null instead of being passed through.
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

export function clientIp(req: Request): string | null {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  if (IPV4.test(first)) return first;
  if (first.includes(':') && first.length <= 45 && IPV6.test(first)) return first;
  return null;
}
