<!--
  Source of truth for the published policy (client's page:
  https://sign2site.com.au/app-privacy/ once live). Rewritten 2026-10-11
  to describe the launch product, not the repo state. Every lifecycle claim
  names its mechanism here (CLAUDE.md doc rule 3); none of this comment is
  published.

  - Code-attempt logs, 24h + nightly prune: migration 007 (pg_cron), IP column 017
  - Security log, 1 year: migration 016 (prune_security_events cron)
  - Session limits 30 days / 24h idle: scripts/apply-security-settings.js
    (Pro plan only; must be applied before this text is published)
  - Two-step sign-in enforcement: migration 018; re-confirmation: _shared/recentAuth.ts
  - Codes unusable at 06:00 next day: codeFactory.expiryNextMorning + 012 grace
  - Photo resize 1600 px: JobPhotoService MAX_PHOTO_DIMENSION
  - Signed URLs 1 h: createSignedUrl(key, 3600)
  - Supabase log retention 7 days: Supabase Pro plan (supabase.com/pricing, 2026-10-11)
  - Resend: domain must be created in the Tokyo (ap-northeast-1) region
  - Google Maps Platform: geocode-address (admin import) + optimize-route (job-site
    coordinates only, never the driver's position)
  - Driver position on the map: DriverMapScreen showsUserLocation (on device only)
  - Mac updates: electron-updater -> GitHub releases (electron-builder.yml publish)
-->

# Sign2Site App Privacy Policy

**Effective date:** 31 May 2026
**Last updated:** 11 October 2026

The Sign2Site app is the job-management app used by Sign2Site and its installation crews to plan sign installations and removals and to record proof that each job was completed. It is available as an iPhone app and as a desktop app for Mac.

This policy explains what information the app collects, why we collect it, where it is kept, who else handles it on our behalf, how long we keep it, and the rights you have.

The app is operated by **Sign2Site Pty Ltd** ("Sign2Site", "we", "us"). For any privacy question, contact **bryanna@sign2site.com.au**.

---

## 1. Who this policy covers

- **Office staff ("admins").** They sign in with an email address and password to import jobs, plan routes, issue driver codes and review completed work.
- **Drivers.** They work a route by entering a 6-digit code issued for that day. Drivers have no account, email address or password in the app.
- **Clients and agents named on a job.** They do not use the app, but a job record includes the site address and the agent's email address.

---

## 2. Information we collect

We collect only what is needed to run jobs and keep the app secure. The app contains no analytics, advertising or tracking tools, and we do not sell personal information or use it for advertising.

### 2.1 Admins

| Information | Why we collect it | Where it is kept |
|---|---|---|
| Email address and password | To sign you in. Your password is stored only in scrambled (hashed) form and cannot be read by anyone, including us | Supabase (our hosting provider) |
| Two-step sign-in key, if you turn two-step sign-in on | To check the 6-digit code from your authenticator app when you sign in | Supabase |
| Security log: each sign-in, admin invitation, account deletion, job deletion and driver-code creation, with your user ID and email address, plus your network (IP) address for invitations and deletions | To detect and investigate misuse of admin accounts | Supabase |
| Google Sheets connection, if you connect it | To import jobs from a Google Sheet you choose | On your own device only; it is never sent to our servers |
| Routes, driver codes and jobs you create | To run the service | Supabase |

### 2.2 Drivers

| Information | Why we collect it | Where it is kept |
|---|---|---|
| The day's 6-digit route code | To open that day's route | Checked by our server; kept in the app's memory during your shift. If you work without signal, unsent uploads (which include the code) are stored on the device until they send, then deleted |
| Job photos | Proof that the work was completed | Supabase, in private storage |
| Your location at the moment a job photo is uploaded | To confirm the photo was taken at the work site | Saved with that job's record in Supabase |
| A random device identifier, created by the app | To limit repeated wrong-code attempts from one device | On the device, and sent with each code attempt |
| The network (IP) address of each code attempt | To limit wrong-code attempts from one network, so codes cannot be guessed by switching devices. Repeated lockouts are recorded in the security log | Supabase |

**Your position on the route map.** While a driver has the route map open, the map shows the driver's current position as a dot, so they can see where they are relative to the next job. This position stays on the phone. It is not sent to us or saved anywhere.

### 2.3 Jobs, clients and agents

Admins import jobs from a Google Sheet. Each job includes the site address, job details and the agent's email address.

- **Site addresses** are converted to map coordinates when the job is imported, so the job can be shown on the driver's map. This is done through Google (see section 5).
- **The agent's email address** is stored with the job so that, once the work is approved, the completion notice is addressed to the right person (see section 4).

### 2.4 What we do not collect

We do not track location in the background or between jobs. We do not access contacts or the microphone. We do not use advertising identifiers or device fingerprinting. We collect nothing beyond what is listed above.

---

## 3. How photos and location are used

A photo is required before a driver can mark a job complete. When the driver uploads it:

1. The photo is reduced to at most 1600 pixels on its longest side.
2. The app takes a single reading of the phone's location.
3. The photo and that location are sent together to Supabase over an encrypted connection.

Photos are kept in private storage and are never publicly accessible. When an authorised person views a photo, the app creates a link to it that stops working after one hour.

---

## 4. Emails the app sends

- **Sign-in emails.** When an admin resets their password, or when one admin invites another, the app emails a one-time code from **noreply@sign2site.com.au**. These emails are sent through Resend (see section 5) and contain the recipient's email address and the code.
- **Completion notices.** Drivers never email anyone from the app. When an admin approves a completed job, the app opens the admin's own email program with a message to the agent already filled in. The admin sends it from their own mailbox, and their email provider's privacy terms apply to it.

---

## 5. Service providers

We use the following providers to run the app. Each handles only the information described here.

| Provider | What it does for the app | Where | What it receives |
|---|---|---|---|
| Supabase Inc. | Database, file storage, sign-in and server functions | Amazon Web Services, Tokyo, Japan | All the admin, driver and job information described above |
| Resend, Inc. | Sends password-reset and invitation emails | Amazon Web Services, Tokyo, Japan | The recipient's email address and the email's content |
| Google LLC | Converts site addresses into map coordinates, works out the best order to visit job sites, and (if an admin connects it) reads the chosen Google Sheet | Google's global infrastructure | Site addresses; the coordinates of the day's job sites (never the driver's own location); the Google Sheet the admin chooses |
| Apple Inc. | Distributes the iPhone app, provides the map shown on iPhone, and (if you choose to share them) crash reports | Apple's global infrastructure | Map requests for the area on screen; crash reports only if you opt in through your iPhone's settings |
| GitHub, Inc. | Hosts the Mac app's downloads and update checks | GitHub's global infrastructure | Your network (IP) address and the app version when the Mac app checks for an update |

---

## 6. Where information is stored

The app's database, files, server functions and sign-in emails are hosted in **Tokyo, Japan**. This means information about Australian users is stored and processed outside Australia. Information is encrypted while it is being sent, and Supabase also encrypts it where it is stored.

---

## 7. How long we keep information

| Information | How long |
|---|---|
| Admin accounts | Until the admin deletes the account in the app (see section 8) or we are asked to delete it |
| Driver route codes | Stop working at 6:00 am the morning after they are issued, with a short extra window so work done without signal can still be sent. The code record stays with the job history it belongs to |
| Jobs, photos and photo locations | Kept as Sign2Site's completion records for as long as Sign2Site needs them, and deleted on Sign2Site's instruction or on a verified request (see section 8) |
| Code-attempt records (device identifier, network address and time) | Deleted automatically each night once they are more than 24 hours old, so kept for at most about 48 hours |
| Security log | Deleted automatically each night once more than one year old |
| Supabase service logs (these include network addresses) | Kept by Supabase for up to 7 days |
| Sign-in emails | Kept by Resend for the period set out in its own privacy terms |
| Driver device identifier | On the device until the app is uninstalled |
| Google Sheets connection | On the admin's device until they disconnect it or uninstall the app |

---

## 8. Your rights

You can ask to see, correct or delete personal information we hold about you by emailing **bryanna@sign2site.com.au**. We will respond within 30 days.

- **Admins** can delete their own account at any time in the app: open **Account**, then **Delete account**. The account and its sign-in details are removed straight away. Jobs and routes the admin created stay with Sign2Site's records because they belong to the business. Contact us if you also want those removed.
- **Drivers** have no account. Uninstalling the app removes everything it stored on the phone. Photos and locations already uploaded stay with Sign2Site's completion records.

If you are not satisfied with our response, you can complain to the Office of the Australian Information Commissioner at **oaic.gov.au**.

---

## 9. Security

- All information is sent over encrypted connections.
- Admin passwords are stored only in hashed form.
- Admins can turn on two-step sign-in, which asks for a code from an authenticator app as well as the password. Once it is on, the database refuses access until the code is entered.
- Deleting an account or inviting a new admin requires entering your password (or authenticator code) again, even when you are already signed in.
- Admin sessions end after 30 days, or after 24 hours without use.
- Repeated wrong driver codes are blocked, both per device and per network.
- Photos are kept in private storage, and links to them expire after one hour.
- Access to the database is restricted so that each user can only reach what their role allows.

No system is completely secure. If you believe you have found a security problem, please email **bryanna@sign2site.com.au** rather than disclosing it publicly.

---

## 10. Children

The app is a workplace tool. It is not intended for anyone under 16, and we do not knowingly collect information from children.

---

## 11. Changes to this policy

If we make a significant change, we will update the "Last updated" date at the top. The current version is always available at the address shown on the app's App Store page.

---

## 12. Contact

**Sign2Site Pty Ltd**
Perth WA 6031, Australia
Email: **bryanna@sign2site.com.au**
