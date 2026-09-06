import { useState, memo } from 'react';
import { View, Text, Alert, Linking } from 'react-native';
import { RouteCodeService } from '../../../services/RouteCodeService';
import { SignJob } from '../../../data/SignJob';
import { colors } from '../../../utils/colors';
import { JobCard } from '../../components/JobCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Pill } from '../../components/Pill';
import { buildCompletionNotice, noticeState } from '../completionNotice.logic';
import { styles } from './styles';

// ─── Job row ─────────────────────────────────────────────────────────────────

// Memoised: admin routes carry the same job counts as driver routes, and a
// pull-to-refresh re-renders the screen. Without this every row rebuilds.
export const RouteJobRow = memo(function RouteJobRow({
  job,
  onSent,
}: {
  job: SignJob;
  onSent: () => void;
}) {
  const [sending, setSending] = useState(false);
  const state = noticeState(job);

  const evidence = job.isComplete && job.photoTimestamp ? (
    <Text style={styles.jobCompletedAt}>
      {`Photo · ${new Date(job.photoTimestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`}
      {job.photoGPSLat
        ? `  ·  ${job.photoGPSLat.toFixed(4)}, ${job.photoGPSLng?.toFixed(4)}`
        : ''}
    </Text>
  ) : !job.isComplete && !job.photoKey ? (
    <Text style={styles.jobPhotoMissing}>Photo not yet taken</Text>
  ) : null;

  // Approve & send. The mail client is handed the composed message; whether
  // the admin then presses send happens outside this app, which is why the
  // confirmation says "opened" rather than "sent". markNoticeSent records the
  // approval either way — see RouteCodeService.markNoticeSent.
  async function approveAndSend() {
    if (state.kind !== 'pending') return;
    setSending(true);
    try {
      const url = buildCompletionNotice(job);
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('no mail handler');
      await Linking.openURL(url);
      await RouteCodeService.markNoticeSent(job.id);
      onSent();
    } catch (err) {
      const noMail = err instanceof Error && err.message === 'no mail handler';
      Alert.alert(
        noMail ? 'No email app set up' : "Couldn't record the notice",
        noMail
          ? `This device has no mail account configured, so nothing was sent and nothing was recorded. Send from a device with mail set up, or contact the agent directly: ${state.email}`
          : err instanceof Error
            ? err.message
            : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  }

  const notice =
    state.kind === 'sent' ? (
      <View style={styles.noticeRow}>
        <Pill
          label="Notice sent"
          color={colors.adminSuccess}
          backgroundColor={colors.adminSuccessBg}
        />
        <Text style={styles.noticeMeta}>
          {state.at.toLocaleDateString()} · {state.at.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    ) : state.kind === 'pending' ? (
      <PrimaryButton
        label={`Approve & Send to ${state.email}`}
        size="admin"
        loading={sending}
        onPress={approveAndSend}
      />
    ) : state.kind === 'no-recipient' ? (
      // Surfaces open-work #21 where it actually costs something: the job is
      // done and nobody can be told, because the Sheets import never fills
      // agent_email.
      <Text style={styles.noticeBlocked}>
        No agent email on this job — nobody can be notified.
      </Text>
    ) : state.kind === 'invalid-recipient' ? (
      <Text style={styles.noticeBlocked}>
        {`Agent email looks malformed (${state.email}) — fix it before sending.`}
      </Text>
    ) : null;

  const footer =
    evidence || notice ? (
      <View style={styles.footer}>
        {evidence}
        {notice}
      </View>
    ) : null;

  return <JobCard job={job} bordered footer={footer} />;
});
