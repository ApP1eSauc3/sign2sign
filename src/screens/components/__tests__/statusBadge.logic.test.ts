import { getJobStatus } from '../statusBadge.logic';
import { colors } from '../../../utils/colors';
import { JobUploadState } from '../../../data/SignJob';

describe('getJobStatus', () => {
  it('is COMPLETE whenever isComplete is true, regardless of uploadState', () => {
    const states: (JobUploadState | undefined)[] = [
      undefined,
      { status: 'idle' },
      { status: 'capturing' },
      { status: 'preview', imageUri: 'x' },
      { status: 'uploading' },
      { status: 'succeeded', photoKey: 'k' },
      { status: 'failed', message: 'm' },
    ];
    for (const state of states) {
      expect(getJobStatus(state, true)).toEqual({
        label: 'COMPLETE',
        textColor: colors.statusComplete,
        bgColor: colors.statusCompleteBg,
      });
    }
  });

  it('is UPLOADING when uploadState is uploading and not complete', () => {
    expect(getJobStatus({ status: 'uploading' }, false)).toEqual({
      label: 'UPLOADING',
      textColor: colors.statusProgress,
      bgColor: colors.statusProgressBg,
    });
  });

  it('is FAILED when uploadState is failed and not complete', () => {
    expect(getJobStatus({ status: 'failed', message: 'oops' }, false)).toEqual({
      label: 'FAILED',
      textColor: colors.statusFailed,
      bgColor: colors.statusFailedBg,
    });
  });

  it.each<JobUploadState | undefined>([
    undefined,
    { status: 'idle' },
    { status: 'capturing' },
    { status: 'preview', imageUri: 'x' },
    { status: 'succeeded', photoKey: 'k' },
  ])('is PENDING for %o when not complete', (state) => {
    expect(getJobStatus(state, false)).toEqual({
      label: 'PENDING',
      textColor: colors.statusPending,
      bgColor: colors.statusPendingBg,
    });
  });
});
