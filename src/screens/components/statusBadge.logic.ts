import { JobUploadState } from '../../data/SignJob';
import { colors } from '../../utils/colors';

export type JobStatusLabel = 'COMPLETE' | 'UPLOADING' | 'FAILED' | 'PENDING';

export interface JobStatus {
  label: JobStatusLabel;
  textColor: string;
  bgColor: string;
}

export function getJobStatus(
  uploadState: JobUploadState | undefined,
  isComplete: boolean
): JobStatus {
  const label: JobStatusLabel = isComplete
    ? 'COMPLETE'
    : uploadState?.status === 'uploading'
    ? 'UPLOADING'
    : uploadState?.status === 'failed'
    ? 'FAILED'
    : 'PENDING';

  switch (label) {
    case 'COMPLETE':
      return { label, textColor: colors.statusComplete, bgColor: colors.statusCompleteBg };
    case 'UPLOADING':
      return { label, textColor: colors.statusProgress, bgColor: colors.statusProgressBg };
    case 'FAILED':
      return { label, textColor: colors.statusFailed, bgColor: colors.statusFailedBg };
    case 'PENDING':
      return { label, textColor: colors.statusPending, bgColor: colors.statusPendingBg };
  }
}
