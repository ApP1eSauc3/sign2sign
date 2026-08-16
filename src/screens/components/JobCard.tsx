import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SignJob, JobUploadState } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { StatusBadge } from './StatusBadge';
import { TypePill } from './TypePill';
import { getJobStatus } from './statusBadge.logic';

interface JobCardProps {
  job: SignJob;
  uploadState?: JobUploadState;
  onPress?: () => void;
  bordered?: boolean;
  dimWhenComplete?: boolean;
  footer?: React.ReactNode;
}

export function JobCard({
  job,
  uploadState,
  onPress,
  bordered = false,
  dimWhenComplete = false,
  footer,
}: JobCardProps) {
  const typeColor = job.jobType === 'install' ? colors.install : colors.removal;
  const status = getJobStatus(uploadState, job.isComplete);

  const content = (
    <>
      <View style={styles.row}>
        <StatusBadge uploadState={uploadState} isComplete={job.isComplete} />
        <TypePill jobType={job.jobType} />
      </View>

      <Text
        style={[
          bordered ? styles.addressAdmin : styles.address,
          job.isComplete && dimWhenComplete && styles.addressComplete,
        ]}
      >
        {job.address}
      </Text>

      <Text style={bordered ? styles.metaAdmin : styles.meta}>
        {job.clientName}
        {job.agentName ? `  ·  ${job.agentName}` : ''}
      </Text>

      {footer}
    </>
  );

  const cardStyle = [
    styles.card,
    { backgroundColor: bordered ? colors.adminSurface : colors.surface, borderLeftColor: typeColor },
    bordered && styles.bordered,
    job.isComplete && dimWhenComplete && styles.cardComplete,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${job.jobType} job at ${job.address}, status ${status.label.toLowerCase()}`}
        accessibilityHint="Opens the job detail to capture a photo and mark complete"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,          // DESIGN §1.6 — standard card
    borderLeftWidth: 4,
    padding: 16,                // DESIGN §1.3 — standardized (was 14/16 across screens)
    minHeight: 64,               // DESIGN §3.4 — primary field interaction
  },
  bordered: {
    borderWidth: 1,
    borderColor: colors.adminCardBorder,
    overflow: 'hidden',
  },
  cardComplete: {
    backgroundColor: colors.bg,  // DESIGN §1.5 — surface drops to base for completed cards
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,             // DESIGN §1.3 — standardized (was 8/10 across screens)
  },
  address: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: 4,
  },
  addressAdmin: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.adminText,
    marginBottom: 4,
  },
  addressComplete: {
    color: colors.textSecondary,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  metaAdmin: {
    fontSize: 13,
    color: colors.adminTextTertiary,
    marginBottom: 4,
  },
});
