import {
  noticeState,
  noticeSubject,
  noticeBody,
  buildCompletionNotice,
} from '../completionNotice.logic';
import { SignJob } from '../../../data/SignJob';

function job(over: Partial<SignJob> = {}): SignJob {
  return {
    id: 'j1',
    clientName: 'Acme Realty',
    agentName: 'Dana Reed',
    agentEmail: 'dana@example.com',
    address: '120 Collins St, Melbourne VIC 3000',
    signDescription: 'Corflute 600x900',
    jobType: 'install',
    latitude: -37.814,
    longitude: 144.9713,
    sortOrder: 1,
    isComplete: true,
    ...over,
  } as SignJob;
}

describe('noticeState', () => {
  it('is not applicable until the job is complete', () => {
    expect(noticeState(job({ isComplete: false })).kind).toBe('not-applicable');
  });

  it('is pending once complete with a valid agent email', () => {
    expect(noticeState(job())).toEqual({ kind: 'pending', email: 'dana@example.com' });
  });

  it('reports sent, and prefers that over pending', () => {
    const at = new Date('2026-09-03T04:31:43Z');
    expect(noticeState(job({ noticeSentAt: at }))).toEqual({ kind: 'sent', at });
  });

  // open-work #21: the Sheets import never populates agent_email, so a
  // finished job can have nobody to notify. The admin should see that.
  it('reports no recipient rather than silently doing nothing', () => {
    expect(noticeState(job({ agentEmail: '' })).kind).toBe('no-recipient');
  });

  it.each([
    'not-an-email',
    'dana@example',
    'dana@@example.com',
    'dana@example.com?cc=attacker@evil.com',
    'dana@example.com\r\nbcc:attacker@evil.com',
  ])('rejects malformed agent email %p', (email) => {
    expect(noticeState(job({ agentEmail: email })).kind).toBe('invalid-recipient');
  });
});

describe('buildCompletionNotice', () => {
  it('addresses the agent and encodes the subject and body', () => {
    const url = buildCompletionNotice(job());
    expect(url.startsWith('mailto:dana@example.com?')).toBe(true);
    expect(url).toContain(encodeURIComponent('120 Collins St'));
  });

  // The '@' is legal unencoded in a mailto and some handlers mishandle %40.
  it('leaves the @ literal in the recipient', () => {
    expect(buildCompletionNotice(job())).not.toContain('%40');
  });

  // The address comes from the Google Sheet. Even though noticeState gates on
  // EMAIL_RE, the encoder must not be the thing standing between a hostile
  // cell and an injected bcc header.
  it('encodes separators in a hostile address so no extra headers appear', () => {
    const url = buildCompletionNotice(job({ agentEmail: 'a@b.com?bcc=evil@x.com' }));
    const recipient = url.slice('mailto:'.length).split('?')[0];
    // "bcc" survives as literal text — that is fine and expected. What must
    // not survive is an unencoded separator, because that is what would make
    // it a header rather than characters in an address.
    expect(recipient).not.toMatch(/[?&=]/);
    expect(recipient).toContain('%3F');
    // Exactly one literal '?' in the whole URL: the one this function wrote.
    expect(url.match(/\?/g)).toHaveLength(1);
  });

  it('carries the job evidence the agent needs', () => {
    const body = noticeBody(job());
    expect(body).toContain('Acme Realty');
    expect(body).toContain('Corflute 600x900');
    expect(body).toContain('120 Collins St');
  });

  it('says installed or removed to match the job type', () => {
    expect(noticeSubject(job())).toContain('installed');
    expect(noticeSubject(job({ jobType: 'removal' }))).toContain('removed');
    expect(noticeBody(job({ jobType: 'removal' }))).toContain('removal');
  });

  it('does not print "undefined" when the agent has no name', () => {
    expect(noticeBody(job({ agentName: '' }))).toContain('Hi there,');
  });
});
