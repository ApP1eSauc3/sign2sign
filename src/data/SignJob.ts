export type JobType = 'install' | 'removal';

export type JobUploadState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { status: 'preview'; imageUri: string }  // photo taken, awaiting driver confirmation
  | { status: 'uploading' }
  | { status: 'succeeded'; photoKey: string }
  | { status: 'failed'; message: string };

export interface SignJob {
  readonly id: string;
  readonly clientName: string;
  readonly agentName: string;
  readonly agentEmail: string;  // imported from Sheets — no manual lookup needed
  readonly address: string;
  readonly signDescription: string;
  readonly jobType: JobType;
  readonly latitude: number;
  readonly longitude: number;
  readonly sortOrder: number;
  isComplete: boolean;          // updated after mark-complete
  photoKey?: string;            // Supabase storage key only — never a signed URL
  photoGPSLat?: number;
  photoGPSLng?: number;
  photoTimestamp?: Date;

  // Completion-notice approval. A completed job with an agentEmail and no
  // noticeSentAt is awaiting admin approval. Deliberately derived rather than
  // a status column — see migration 015. The driver client can never write
  // these: anon holds no UPDATE on jobs since 013.
  noticeSentAt?: Date;
  noticeSentBy?: string;
}

export interface DriverSession {
  readonly routeCode: string;
  readonly driverSlot: number;  // which "Driver N" slot this code belongs to
  jobs: SignJob[];               // individual jobs updated as they complete
}

export enum AppMode {
  Undecided = 'undecided',
  // On the admin side but not signed in: login, forgot-password and invite
  // screens. Separate from AdminAuthenticated so that losing a session here,
  // such as SetPasswordScreen's deliberate sign-out after a refused password,
  // does not eject the user to mode select before the error can be shown.
  AdminPending = 'admin_pending',
  AdminAuthenticated = 'admin',
  DriverActive = 'driver',
}

export interface DailyCode {
  id: string;
  code: string;
  driverSlot: number;       // "Driver 1", "Driver 2", etc.
  createdDate: string;      // ISO date string
  expiresAt: string;        // ISO datetime string
  isActive: boolean;
}
