import { secureStorage } from '../utils/secureStorage';
import { supabase } from './supabaseClient';
import { GoogleAuthService } from './GoogleAuthService';
import { SignJob, JobType } from '../data/SignJob';

const MAX_IMPORT_ROWS = 500;
const GOOGLE_TOKEN_KEY = 'google_oauth_token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const GEOCODING_API = 'https://maps.googleapis.com/maps/api/geocode/json';

// Sign2Site actual sheet column layout:
// A: Date (serial number with UNFORMATTED_VALUE), B: AGENCY, C: AGENT,
// D: NOTES (install instructions), E: SIZE (sign dimensions), F: Printed (skip), G: ADDRESS
const COL = {
  date: 0,
  clientName: 1,   // B — AGENCY
  agentName: 2,    // C — AGENT (name; sometimes includes job notes like "(ADD WINGS)")
  notes: 3,        // D — NOTES (install placement instructions)
  size: 4,         // E — sign dimensions (6x4, 4x3, 6x2 SS, COR, etc.)
  // index 5 = F (Printed) — not used
  address: 6,      // G — ADDRESS (must be non-empty; used to geocode)
};

// Google Sheets returns date cells as Excel serial numbers when valueRenderOption=UNFORMATTED_VALUE.
// Serial 0 = 1899-12-30; each integer is one calendar day.
function serialToLocalDate(serial: number): Date {
  const base = new Date(1899, 11, 30);
  base.setDate(base.getDate() + Math.floor(serial));
  return base;
}

function serialMatchesDate(serial: unknown, target: Date): boolean {
  if (typeof serial !== 'number') return false;
  const d = serialToLocalDate(serial);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

// Detect removal jobs from agent + notes text. The sheet uses no explicit job_type column;
// "removal" only appears as incidental text in rare cases. Defaults to 'install'.
function detectJobType(agentText: string, notesText: string): JobType {
  const combined = `${agentText} ${notesText}`.toLowerCase();
  if (
    combined.includes('removal') ||
    combined.includes('take down') ||
    combined.includes('collect sign')
  ) {
    return 'removal';
  }
  return 'install';
}

async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<{ latitude: number; longitude: number }> {
  const url = `${GEOCODING_API}?address=${encodeURIComponent(address)}&region=au&key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoding request failed (${response.status})`);

  const json = await response.json() as {
    status: string;
    results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
  };

  if (json.status !== 'OK' || !json.results[0]) {
    throw new Error(`Could not geocode "${address}" — status: ${json.status}`);
  }

  const { lat, lng } = json.results[0].geometry.location;
  return { latitude: lat, longitude: lng };
}

export const GoogleSheetsService = {
  async getStoredToken(): Promise<string | null> {
    return secureStorage.getItem(GOOGLE_TOKEN_KEY);
  },

  async storeToken(token: string): Promise<void> {
    await secureStorage.setItem(GOOGLE_TOKEN_KEY, token);
  },

  async clearToken(): Promise<void> {
    await secureStorage.removeItem(GOOGLE_TOKEN_KEY);
  },

  // Fetch rows from a Google Sheet tab, filter by date, geocode each address,
  // and return SignJob objects ready to be saved via saveJobsToRoute().
  async importJobs(
    sheetId: string,
    sheetName: string,
    importDate: Date
  ): Promise<Omit<SignJob, 'id' | 'isComplete'>[]> {
    const token = await GoogleSheetsService.getStoredToken();
    if (!token) throw new Error('No Google OAuth token stored. Authenticate first.');

    const mapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!mapsApiKey) {
      throw new Error(
        'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set — required to geocode addresses during import.'
      );
    }

    // Single-quote wrap for tab names that contain spaces or punctuation.
    // Sheets A1 notation escapes embedded single quotes by doubling them
    // (e.g. "John's Sheet" → 'John''s Sheet').
    const needsQuoting = /[^A-Za-z0-9_]/.test(sheetName);
    const sheetRef = needsQuoting ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
    const range = `${sheetRef}!A2:G`;
    // UNFORMATTED_VALUE returns date cells as serial numbers, avoiding locale-dependent
    // date string formats that vary between Australian and US Sheets settings.
    const url = `${SHEETS_API}/${sheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;

    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      const newToken = await GoogleAuthService.refreshAccessToken();
      if (!newToken) {
        await GoogleSheetsService.clearToken();
        throw new Error('Google session expired. Please re-authenticate.');
      }
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${newToken}` },
      });
    }

    if (response.status === 401) {
      await GoogleSheetsService.clearToken();
      throw new Error('Google session expired. Please re-authenticate.');
    }

    if (!response.ok) {
      throw new Error(`Google Sheets error: ${response.status}`);
    }

    const json = (await response.json()) as { values?: unknown[][] };
    const allRows: unknown[][] = json.values ?? [];

    // Geocode with in-memory cache — avoids duplicate API calls when multiple jobs
    // share the same address (common for multi-unit properties).
    const coordCache = new Map<string, { latitude: number; longitude: number }>();
    const jobs: Omit<SignJob, 'id' | 'isComplete'>[] = [];
    let matchCount = 0;

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const rowNum = i + 2; // 1-indexed, offset by skipped header row

      // Skip rows without an address or not matching the target date
      const rawAddress = row[COL.address];
      if (!rawAddress || !String(rawAddress).trim()) continue;
      if (!serialMatchesDate(row[COL.date], importDate)) continue;

      matchCount++;
      if (matchCount > MAX_IMPORT_ROWS) {
        throw new Error(
          `More than ${MAX_IMPORT_ROWS} jobs found for this date — split them across separate route codes first.`
        );
      }

      const address = String(rawAddress).trim();
      const notes = row[COL.notes] ? String(row[COL.notes]).trim() : '';
      const size = row[COL.size] ? String(row[COL.size]).trim() : '';
      const agentText = row[COL.agentName] ? String(row[COL.agentName]).trim() : '';

      // Row reference appended so admin can trace back to the source sheet for contact details
      const noteParts = [notes, size && `(${size})`].filter(Boolean).join(' ');
      const signDescription = noteParts ? `${noteParts} — Row ${rowNum}` : `Row ${rowNum}`;

      let coords = coordCache.get(address);
      if (!coords) {
        try {
          coords = await geocodeAddress(address, mapsApiKey);
          coordCache.set(address, coords);
        } catch (err: unknown) {
          throw new Error(
            `Row ${rowNum}: ${err instanceof Error ? err.message : 'Geocoding failed.'}`
          );
        }
      }

      jobs.push({
        clientName: row[COL.clientName] ? String(row[COL.clientName]).trim() : '',
        agentName: agentText,
        agentEmail: '',  // not in sheet — admin adds via route detail screen before sending emails
        address,
        signDescription,
        jobType: detectJobType(agentText, notes),
        latitude: coords.latitude,
        longitude: coords.longitude,
        sortOrder: jobs.length + 1,
      });
    }

    if (matchCount === 0) {
      const dateLabel = `${importDate.getDate()}/${importDate.getMonth() + 1}/${importDate.getFullYear()}`;
      throw new Error(
        `No jobs found for ${dateLabel} in "${sheetName}". ` +
        `Check the date and tab name are correct.`
      );
    }

    return jobs;
  },

  // Save parsed jobs to Supabase, linked to a route code.
  // Replaces any existing jobs for this route — clean reimport, no duplicates.
  async saveJobsToRoute(
    jobs: Omit<SignJob, 'id' | 'isComplete'>[],
    routeCodeId: string
  ): Promise<void> {
    const { error: deleteError } = await supabase
      .from('jobs')
      .delete()
      .eq('route_code_id', routeCodeId);

    if (deleteError) throw new Error(`Could not clear existing jobs: ${deleteError.message}`);

    if (jobs.length === 0) return;

    const records = jobs.map((job) => ({
      route_code_id: routeCodeId,
      client_name: job.clientName,
      agent_name: job.agentName,
      agent_email: job.agentEmail || null,
      address: job.address,
      sign_description: job.signDescription,
      job_type: job.jobType,
      latitude: job.latitude,
      longitude: job.longitude,
      sort_order: job.sortOrder,
      is_complete: false,
    }));

    const { error } = await supabase.from('jobs').insert(records);
    if (error) throw new Error(error.message);
  },
};
