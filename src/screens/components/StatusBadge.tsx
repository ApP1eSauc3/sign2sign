import { JobUploadState } from '../../data/SignJob';
import { Pill } from './Pill';
import { getJobStatus } from './statusBadge.logic';

interface StatusBadgeProps {
  uploadState?: JobUploadState;
  isComplete: boolean;
}

export function StatusBadge({ uploadState, isComplete }: StatusBadgeProps) {
  const status = getJobStatus(uploadState, isComplete);
  return (
    <Pill
      variant="filled"
      label={status.label}
      color={status.textColor}
      backgroundColor={status.bgColor}
    />
  );
}
