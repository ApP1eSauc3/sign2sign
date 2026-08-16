import { JobUploadState } from '../../data/SignJob';
import { colors } from '../../utils/colors';

export interface AdvancingButtonState {
  label: string;
  color: string;
  enabled: boolean;
  loading: boolean;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled upload state: ${JSON.stringify(x)}`);
}

// Relocated verbatim from DriverJobScreen's getButtonState — matches
// CLAUDE.md §3.1's advancing action button table exactly.
export function getAdvancingButtonState(
  state: JobUploadState,
  isComplete: boolean,
  isMarkingComplete: boolean
): AdvancingButtonState {
  if (isComplete) {
    return { label: '✓ Complete', color: colors.statusCompleteBg, enabled: false, loading: false };
  }
  switch (state.status) {
    case 'idle':
      return { label: 'Take Photo', color: colors.brand, enabled: true, loading: false };
    case 'capturing':
      return { label: 'Opening Camera…', color: colors.brandPressed, enabled: false, loading: true };
    case 'preview':
      return { label: 'Upload Photo', color: colors.brand, enabled: true, loading: false };
    case 'uploading':
      return { label: 'Uploading…', color: colors.brandPressed, enabled: false, loading: true };
    case 'succeeded':
      return {
        label: isMarkingComplete ? 'Marking Complete…' : 'Mark Complete',
        color: colors.statusComplete,
        enabled: !isMarkingComplete,
        loading: isMarkingComplete,
      };
    case 'failed':
      return { label: 'Retry Photo', color: colors.statusFailed, enabled: true, loading: false };
    default:
      return assertNever(state);
  }
}
