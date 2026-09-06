import { JobType, SignJob } from '../../data/SignJob';

// DB row shapes — map snake_case DB columns to camelCase domain types at the boundary.
// These types live here, not in src/data/, because they are a DB implementation detail.
export type JobRow = {
  id: string;
  client_name: string;
  agent_name: string | null;
  agent_email: string | null;
  address: string;
  sign_description: string;
  job_type: string;
  latitude: number;
  longitude: number;
  sort_order: number;
  is_complete: boolean;
  photo_key: string | null;
  photo_gps_lat: number | null;
  photo_gps_lng: number | null;
  photo_timestamp: string | null;
  notice_sent_at?: string | null;
  notice_sent_by?: string | null;
};

export function mapJobRow(j: JobRow): SignJob {
  return {
    id: j.id,
    clientName: j.client_name,
    agentName: j.agent_name ?? '',
    agentEmail: j.agent_email ?? '',
    address: j.address,
    signDescription: j.sign_description,
    jobType: (j.job_type === 'removal' ? 'removal' : 'install') as JobType,
    latitude: j.latitude,
    longitude: j.longitude,
    sortOrder: j.sort_order,
    isComplete: j.is_complete,
    photoKey: j.photo_key ?? undefined,
    photoGPSLat: j.photo_gps_lat ?? undefined,
    photoGPSLng: j.photo_gps_lng ?? undefined,
    photoTimestamp: j.photo_timestamp ? new Date(j.photo_timestamp) : undefined,
    // Optional on the row type: validate_route_code's payload does not select
    // these, and it should not — notice approval is admin state and the
    // driver client has no business reading it.
    noticeSentAt: j.notice_sent_at ? new Date(j.notice_sent_at) : undefined,
    noticeSentBy: j.notice_sent_by ?? undefined,
  };
}
