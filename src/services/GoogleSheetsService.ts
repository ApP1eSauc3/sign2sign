import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabaseClient';
import { GoogleAuthService } from './GoogleAuthService';
import { SignJob, JobType } from '../data/SignJob';

const MAX_IMPORT_ROWS = 500;

const GOOGLE_TOKEN_KEY = 'google_oauth_token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column positions in the expected sheet layout:
// A: Client Name, B: Agent Name, C: Agent Email, D: Address,
// E: Sign Description, F: Job Type (install/removal),
// G: Latitude, H: Longitude, I: Sort Order
const COL = {
  clientName: 0,
  agentName: 1,
  agentEmail: 2,
  address: 3,
  signDescription: 4,
  jobType: 5,
  latitude: 6,
  longitude: 7,
  sortOrder: 8,
};

export const GoogleSheetsService = {
  async getStoredToken(): Promise<string | null> {
    return SecureStore.getItemAsync(GOOGLE_TOKEN_KEY);
  },

  async storeToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(GOOGLE_TOKEN_KEY, token);
  },

  async clearToken(): Promise<void> {
    await SecureStore.deleteItemAsync(GOOGLE_TOKEN_KEY);
  },

  // Fetch rows from a Google Sheet and parse into SignJob objects.
  // The caller is responsible for saving the returned jobs to Supabase.
  async importJobs(sheetId: string): Promise<Omit<SignJob, 'id' | 'isComplete'>[]> {
    const token = await GoogleSheetsService.getStoredToken();
    if (!token) throw new Error('No Google OAuth token stored. Authenticate first.');

    const range = 'Sheet1!A2:I'; // skip header row
    const url = `${SHEETS_API}/${sheetId}/values/${range}`;

    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      // Attempt silent refresh before giving up
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

    const json = await response.json();
    const allRows: string[][] = json.values ?? [];
    const rows = allRows.filter((row) => row[COL.address]); // skip blank rows

    if (rows.length > MAX_IMPORT_ROWS) {
      throw new Error(
        `Sheet contains ${rows.length} jobs — maximum import is ${MAX_IMPORT_ROWS}. Split into smaller sheets.`
      );
    }

    return rows.map((row, index) => {
      const rowNum = index + 2; // +2: 1-indexed + skipped header

      // Validate job type — must be exactly "install" or "removal" (case-insensitive)
      const rawType = row[COL.jobType]?.toLowerCase().trim();
      if (rawType !== 'install' && rawType !== 'removal') {
        throw new Error(
          `Row ${rowNum}: invalid job type "${row[COL.jobType] ?? ''}" — must be "install" or "removal"`
        );
      }

      // Validate coordinates — NaN would silently place the job at (0, 0)
      const lat = parseFloat(row[COL.latitude]);
      const lng = parseFloat(row[COL.longitude]);
      if (isNaN(lat) || isNaN(lng)) {
        throw new Error(
          `Row ${rowNum}: missing or invalid coordinates — columns G and H must contain numbers`
        );
      }

      return {
        clientName: row[COL.clientName] ?? '',
        agentName: row[COL.agentName] ?? '',
        agentEmail: row[COL.agentEmail] ?? '',
        address: row[COL.address] ?? '',
        signDescription: row[COL.signDescription] ?? '',
        jobType: rawType as JobType,
        latitude: lat,
        longitude: lng,
        sortOrder: parseInt(row[COL.sortOrder], 10) || index + 1,
      };
    });
  },

  // Save parsed jobs to Supabase, linked to a route code.
  // Deletes any existing jobs for this route code first — makes every import
  // a clean replace rather than an additive append, preventing duplicate job lists
  // if the admin imports the same sheet twice or corrects a mistake by reimporting.
  async saveJobsToRoute(
    jobs: Omit<SignJob, 'id' | 'isComplete'>[],
    routeCodeId: string
  ): Promise<void> {
    // Clear existing jobs for this route before inserting — clean reimport
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
      agent_email: job.agentEmail,
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
