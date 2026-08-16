import { getAdvancingButtonState } from '../advancingActionButton.logic';
import { colors } from '../../../utils/colors';
import { JobUploadState } from '../../../data/SignJob';

describe('getAdvancingButtonState', () => {
  it('short-circuits to complete regardless of uploadState when isComplete is true', () => {
    expect(getAdvancingButtonState({ status: 'idle' }, true, false)).toEqual({
      label: '✓ Complete',
      color: colors.statusCompleteBg,
      enabled: false,
      loading: false,
    });
  });

  it('idle -> Take Photo, enabled, brand', () => {
    expect(getAdvancingButtonState({ status: 'idle' }, false, false)).toEqual({
      label: 'Take Photo',
      color: colors.brand,
      enabled: true,
      loading: false,
    });
  });

  it('capturing -> Opening Camera…, disabled, loading, brandPressed', () => {
    expect(getAdvancingButtonState({ status: 'capturing' }, false, false)).toEqual({
      label: 'Opening Camera…',
      color: colors.brandPressed,
      enabled: false,
      loading: true,
    });
  });

  it('preview -> Upload Photo, enabled, brand', () => {
    const state: JobUploadState = { status: 'preview', imageUri: 'file://x.jpg' };
    expect(getAdvancingButtonState(state, false, false)).toEqual({
      label: 'Upload Photo',
      color: colors.brand,
      enabled: true,
      loading: false,
    });
  });

  it('uploading -> Uploading…, disabled, loading, brandPressed', () => {
    expect(getAdvancingButtonState({ status: 'uploading' }, false, false)).toEqual({
      label: 'Uploading…',
      color: colors.brandPressed,
      enabled: false,
      loading: true,
    });
  });

  it('succeeded + not marking complete -> Mark Complete, enabled, statusComplete', () => {
    const state: JobUploadState = { status: 'succeeded', photoKey: 'k' };
    expect(getAdvancingButtonState(state, false, false)).toEqual({
      label: 'Mark Complete',
      color: colors.statusComplete,
      enabled: true,
      loading: false,
    });
  });

  it('succeeded + marking complete -> Marking Complete…, disabled, loading', () => {
    const state: JobUploadState = { status: 'succeeded', photoKey: 'k' };
    expect(getAdvancingButtonState(state, false, true)).toEqual({
      label: 'Marking Complete…',
      color: colors.statusComplete,
      enabled: false,
      loading: true,
    });
  });

  it('failed -> Retry Photo, enabled, statusFailed', () => {
    const state: JobUploadState = { status: 'failed', message: 'network error' };
    expect(getAdvancingButtonState(state, false, false)).toEqual({
      label: 'Retry Photo',
      color: colors.statusFailed,
      enabled: true,
      loading: false,
    });
  });
});
