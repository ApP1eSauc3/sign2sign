import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { secureStorage } from '../utils/secureStorage';

// Required: create a project at console.cloud.google.com, enable the Sheets API,
// and create OAuth2 credentials.
//
// CRITICAL — credential type for Electron:
//   Use a "Desktop app" (a.k.a. "Native") credential, NOT a "Web application"
//   one. Web credentials require client_secret on both /token exchange and
//   /token refresh, and we cannot ship a secret in a public client. With a
//   Desktop credential + PKCE (which expo-auth-session/providers/google
//   uses by default), neither call needs a secret and refresh works as below.
//   "iOS" credentials are similarly secret-less and correct for native iOS.
const GOOGLE_CLIENT_ID_IOS = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? '';
const GOOGLE_CLIENT_ID_WEB = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? '';

const TOKEN_KEY = 'google_oauth_token';
const REFRESH_KEY = 'google_oauth_refresh_token';
// The OAuth client the tokens were issued under. Google ties a refresh token to
// the exact client_id that minted it, so we persist it and reuse it on refresh.
// On iOS this is the iOS client; on Electron/web it's the web client.
const CLIENT_ID_KEY = 'google_oauth_client_id';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

// Required for expo-auth-session to handle the redirect back from the browser
WebBrowser.maybeCompleteAuthSession();

export const GoogleAuthService = {
  // Build the auth request — call this in the component using useAuthRequest
  makeRequest() {
    return AuthSession.makeRedirectUri({ scheme: 'sign2sign', path: 'oauth' });
  },

  // Exchange an auth code for tokens and persist them.
  // `clientId` MUST be the same client the authorize request was built with
  // (request.clientId) — Google rejects the exchange if the code was issued to a
  // different client than the one presenting it.
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    clientId: string,
    codeVerifier?: string,
  ): Promise<void> {
    const params: Record<string, string> = {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    if (codeVerifier) params.code_verifier = codeVerifier;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });

    const json = await response.json();
    if (!response.ok) throw new Error(json.error_description ?? 'Token exchange failed');

    await secureStorage.setItem(TOKEN_KEY, json.access_token);
    await secureStorage.setItem(CLIENT_ID_KEY, clientId);
    if (json.refresh_token) {
      await secureStorage.setItem(REFRESH_KEY, json.refresh_token);
    }
  },

  // Silently refresh the access token using the stored refresh token
  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await secureStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;

    // Reuse the client the token was issued under; fall back for tokens stored
    // before this key existed.
    const clientId =
      (await secureStorage.getItem(CLIENT_ID_KEY)) || GOOGLE_CLIENT_ID_WEB || GOOGLE_CLIENT_ID_IOS;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const json = await response.json();
    if (!response.ok) return null;

    await secureStorage.setItem(TOKEN_KEY, json.access_token);
    return json.access_token;
  },

  async isConnected(): Promise<boolean> {
    const token = await secureStorage.getItem(TOKEN_KEY);
    return !!token;
  },

  async disconnect(): Promise<void> {
    await secureStorage.removeItem(TOKEN_KEY);
    await secureStorage.removeItem(REFRESH_KEY);
    await secureStorage.removeItem(CLIENT_ID_KEY);
  },

  // SCOPES exported so the auth request component can use them
  SCOPES,
  CLIENT_ID_IOS: GOOGLE_CLIENT_ID_IOS,
  CLIENT_ID_WEB: GOOGLE_CLIENT_ID_WEB,
};
