import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabaseClient';

// Geocoding goes through our own Edge Function, never to Google directly.
//
// Google Maps Platform web service APIs accept only an IP-address application
// restriction — not an iOS bundle ID, not an Android signature
// (https://developers.google.com/maps/api-security-best-practices, verified
// 2026-09-03). An IP allowlist cannot describe an admin laptop, so a key
// shipped in this bundle would be an unrestricted key on the client's billing
// account, extractable by anyone who installs the app. Google's guidance for
// this exact case is to proxy, so the key lives as a Supabase secret and
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY no longer exists.
//
// The function returns Google's own `{ status, results }` shape, so the retry
// logic below is unchanged from when it spoke to Google directly.
const GEOCODE_FUNCTION = `${SUPABASE_URL}/functions/v1/geocode-address`;

// Geocoding runs concurrently, but not unboundedly. The Geocoding API's
// documented default quota is 25 QPS per project with a 3,000/minute ceiling
// (https://developers.google.com/maps/documentation/geocoding/usage-and-billing,
// verified 2026-08-21). Concurrency alone does not bound QPS — throughput is
// limit/latency — so 5 in flight is paired with OVER_QUERY_LIMIT backoff below
// rather than trusted on its own. It turns a 40-address import from ~40
// sequential round trips into ~8 waves.
export const GEOCODE_CONCURRENCY = 5;
const GEOCODE_MAX_RETRIES = 3;
const GEOCODE_BACKOFF_BASE_MS = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Proxy-side failures that no amount of backoff will clear. Each maps to a
// message naming the thing an operator can actually go and fix — the whole
// reason for distinguishing them from a transient 5xx.
//
// `server_key_missing` is the one that matters most: it is what a deployment
// with no GOOGLE_MAPS_API_KEY secret looks like from here, and before this
// mapping existed it would have surfaced as "Geocoding request failed (503)"
// after three pointless retries.
const PERMANENT_GEOCODE_ERRORS: Record<string, string> = {
  server_key_missing:
    'Address lookup is not configured on the server — the GOOGLE_MAPS_API_KEY secret is not set. See the Maps key runbook in the handover.',
  unauthorized:
    'Your admin session has expired. Sign out, sign in again, and retry the import.',
  invalid_address:
    'The server rejected an address as empty or too long.',
  payload_too_large:
    'The server rejected an address as too long.',
  method_not_allowed:
    'Address lookup rejected the request. The geocode-address function may be out of date — redeploy it.',
};

// Proxy errors arrive as { "error": "<code>" }. A success carries `status`
// instead, so the two shapes never collide. Never throws: a body that is not
// JSON at all (an HTML error page from the gateway, say) simply means we have
// no code to act on, and the caller falls back to status-based handling.
async function readProxyErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

// Retries only the transient shapes: the API's own OVER_QUERY_LIMIT status (a
// 200 response body, not an HTTP error), HTTP 429, and 5xx. Everything else —
// ZERO_RESULTS, REQUEST_DENIED, a bad key — is permanent, and retrying it just
// spends quota before failing anyway.
//
// Before this, a single transient rate-limit response aborted the entire
// import and the admin had to start over.
export async function geocodeAddress(
  address: string,
  accessToken: string
): Promise<{ latitude: number; longitude: number }> {
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < GEOCODE_MAX_RETRIES;

    let response: Response;
    try {
      response = await fetch(GEOCODE_FUNCTION, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The gateway routes on the anon apikey; the bearer token is the
          // admin's own session, which the function resolves to a real
          // auth.users row. The anon key would satisfy the gateway's JWT
          // check but not that lookup — which is the point.
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ address }),
      });
    } catch (err) {
      // fetch rejects only on network failure.
      if (canRetry) {
        await sleep(GEOCODE_BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`Geocoding request failed — check your connection.`);
    }

    if (!response.ok) {
      // A proxy-side refusal that retrying cannot fix must not be spent on
      // three rounds of backoff and then reported as a generic 503. These are
      // operator errors, and the message is the whole value of catching them.
      const proxyError = await readProxyErrorCode(response);
      const permanent = proxyError ? PERMANENT_GEOCODE_ERRORS[proxyError] : undefined;
      if (permanent) throw new Error(permanent);

      if (response.status === 429 || response.status >= 500) {
        if (canRetry) {
          await sleep(GEOCODE_BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }
        throw new Error(`Geocoding request failed (${response.status})`);
      }

      throw new Error(`Geocoding request failed (${response.status})`);
    }

    const json = await response.json() as {
      status: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };

    if (json.status === 'OVER_QUERY_LIMIT' && canRetry) {
      await sleep(GEOCODE_BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }

    if (json.status !== 'OK' || !json.results[0]) {
      throw new Error(`Could not geocode "${address}" — status: ${json.status}`);
    }

    const { lat, lng } = json.results[0].geometry.location;
    return { latitude: lat, longitude: lng };
  }
}
