import { memo } from 'react';
import { View, Text } from 'react-native';
import { SignJob, JobUploadState } from '../../../data/SignJob';
import { colors } from '../../../utils/colors';
import { styles } from './styles';

// ─── Callout card ─────────────────────────────────────────────────────────────

export const JobCallout = memo(function JobCallout({
  job,
  uploadState,
}: {
  job: SignJob;
  uploadState?: JobUploadState;
}) {
  const typeColor = job.jobType === 'install' ? colors.install : colors.removal;

  const statusLabel = job.isComplete
    ? 'COMPLETE'
    : uploadState?.status === 'succeeded'
    ? 'PHOTO DONE'
    : uploadState?.status === 'failed'
    ? 'PHOTO FAILED'
    : 'PENDING';

  const statusColor = job.isComplete || uploadState?.status === 'succeeded'
    ? colors.statusComplete
    : uploadState?.status === 'failed'
    ? colors.statusFailed
    : colors.statusPending;

  return (
    <View style={styles.callout}>
      {/* Type + status badges */}
      <View style={styles.calloutBadgeRow}>
        <View style={[styles.calloutBadge, { borderColor: typeColor }]}>
          <Text style={[styles.calloutBadgeText, { color: typeColor }]}>
            {job.jobType.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.calloutBadge, { borderColor: statusColor, marginLeft: 6 }]}>
          <Text style={[styles.calloutBadgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Address */}
      <Text style={styles.calloutAddress}>{job.address}</Text>

      {/* Client · Agent */}
      <Text style={styles.calloutMeta}>
        {job.clientName}
        {job.agentName ? `  ·  ${job.agentName}` : ''}
      </Text>

      {/* CTA */}
      <Text style={styles.calloutCta}>Open job →</Text>
    </View>
  );
});
