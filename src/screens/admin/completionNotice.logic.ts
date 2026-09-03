import { SignJob } from '../../data/SignJob';

// Completion-notice composition, extracted as pure logic so it can be tested
// without a renderer — the `.logic.ts` pattern already used by
// advancingActionButton and statusBadge.
//
// This moved here from DriverJobScreen on 2026-09-03. It used to run on the
// driver's phone and open the driver's own mail app, so the client received a
// completion notice from a crew member's personal address, editable before
// sending, with no record it happened. Notices are now composed here, approved
// by an admin, and sent from the business account.

export type NoticeState =
  | { kind: 'not-applicable' }                      // not complete
  | { kind: 'no-recipient' }                        // complete, but no agent email
  | { kind: 'invalid-recipient'; email: string }    // complete, email malformed
  | { kind: 'pending'; email: string }              // awaiting admin approval
  | { kind: 'sent'; at: Date };

// agent_email originates from the Google Sheet — semi-trusted admin data, not
// ours to trust. A value containing '?' / '&' / CRLF could inject extra mailto
// headers (cc/bcc) and silently copy the notice to an address nobody chose.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function noticeState(job: SignJob): NoticeState {
  if (!job.isComplete) return { kind: 'not-applicable' };
  if (job.noticeSentAt) return { kind: 'sent', at: job.noticeSentAt };
  if (!job.agentEmail) return { kind: 'no-recipient' };
  if (!EMAIL_RE.test(job.agentEmail)) {
    return { kind: 'invalid-recipient', email: job.agentEmail };
  }
  return { kind: 'pending', email: job.agentEmail };
}

export function noticeSubject(job: SignJob): string {
  const verb = job.jobType === 'install' ? 'installed' : 'removed';
  return `Sign ${verb} — ${job.address}`;
}

export function noticeBody(job: SignJob): string {
  const noun = job.jobType === 'install' ? 'installation' : 'removal';
  return (
    `Hi ${job.agentName || 'there'},\n\n` +
    `This is to confirm that the sign ${noun} at:\n\n` +
    `${job.address}\n\n` +
    `has been completed by the Sign2Sign crew.\n\n` +
    `Client: ${job.clientName}\n` +
    `Sign: ${job.signDescription}\n\n` +
    `Regards,\nSign2Sign`
  );
}

// Percent-encode everything except the '@', which is legal unencoded in a
// mailto and which some mail handlers mishandle when encoded.
export function buildCompletionNotice(job: SignJob): string {
  const to = encodeURIComponent(job.agentEmail).replace(/%40/g, '@');
  const subject = encodeURIComponent(noticeSubject(job));
  const body = encodeURIComponent(noticeBody(job));
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
