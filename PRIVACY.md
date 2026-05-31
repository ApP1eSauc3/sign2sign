# Sign2Sign — Privacy Policy

**Effective date:** 2026-05-31
**Last updated:** 2026-05-31

This policy explains what data the Sign2Sign mobile app and Electron admin
app ("Sign2Sign", "the app") collect, why, how it is stored, and what your
rights are.

Sign2Sign is operated by **Sign2Site Pty Ltd** ("we", "us") on behalf
of Sign2Site (sign2site.com.au). For privacy enquiries contact
**bryanna@sign2sign.com.au**.

---

## 1. Who uses Sign2Sign

The app has two user types:

- **Admins** — office staff who sign in with an email + password to manage
  routes, import jobs, and review completion records.
- **Drivers** — field crew who enter a 6-digit daily code to work a route.
  Drivers have no account, no email, no password — the code is the only
  credential.

This policy covers both.

---

## 2. What we collect, and why

We collect only what the job needs. There is no analytics SDK, no
advertising SDK, and no third-party tracking in the app (verified against
`package.json`).

### From admins

| Data | Why we need it | Where it lives |
|---|---|---|
| Email address + password | Sign in to the admin console | Supabase Auth |
| Google OAuth token (only if you connect Google Sheets) | Import jobs from a Sheet you own | Device SecureStore — never leaves your device |
| Routes, codes, and job imports you create | Operate the service | Supabase Postgres |

### From drivers

| Data | Why we need it | Where it lives |
|---|---|---|
| 6-digit daily route code | Authenticate you for that day's route | Sent to a Supabase Edge Function, not stored client-side |
| Job photos (camera) | Evidence the work was completed | Supabase Storage (bucket `job-photos`) |
| GPS latitude/longitude at the moment a photo is taken | Verify the photo was taken at the work site | Stored on the job record (`photo_gps_lat`, `photo_gps_lng`) |
| Anonymous device ID (random UUID) | Per-device rate limit on code-validation attempts | Device SecureStore + sent with each code attempt |

We do **not** collect: continuous location tracking, contacts, microphone
audio, advertising identifiers, device fingerprints, or any data not
listed above. The Android `RECORD_AUDIO` permission is declared by an
Expo dependency but is not exercised by Sign2Sign code.

### From a Google Sheet you import

When an admin imports jobs from a Google Sheet, each job row carries a
client's **agent email**. We store it on the job so the driver's
completion email can be addressed to the correct agent automatically.
Agents are not users of Sign2Sign; their email is treated as job
metadata supplied by you.

---

## 3. How photos and GPS are used

A photo is mandatory before a driver can mark a job complete. At the
moment the photo upload starts:

1. The camera captures the image. We resize it to a maximum of 1600 px
   on the longest edge before upload.
2. The app reads the device's current GPS coordinates.
3. The photo file and the GPS coordinates are sent to Supabase together,
   over HTTPS.

The GPS reading is a single point-in-time fix. We do not track location
between photos, do not run background location, and do not record
location at any other point in the job flow.

Photos are stored as opaque storage keys — they are not publicly
accessible. The app generates a short-lived signed URL (1 hour) only at
display time, only for authorised viewers.

---

## 4. Sub-processors

| Sub-processor | Service | Region | What it sees |
|---|---|---|---|
| Supabase Inc. | Database, storage, authentication, edge functions | AWS Asia-Pacific (Tokyo) | All admin and job data described above |
| Google LLC | Sheets API (only if an admin chooses to import from Google Sheets) | Google global infrastructure | The Sheet you authorise; OAuth token stays on your device |
| Apple Inc. | App Store distribution, push receipt of crash logs you opt to share | Apple global infrastructure | App metadata; crash logs only if you opt in via iOS Settings |

If you complete a job, the app opens your default mail client with a
prefilled message addressed to the agent email on the job. The message
content and recipient are then handled by your mail provider under their
own privacy terms.

---

## 5. Where data is processed

Supabase hosts the database, storage bucket, and edge functions in
**AWS Asia-Pacific (Tokyo)**. If you use the app from outside Australia
your data is transferred internationally to that region.

---

## 6. How long we keep things

| Data | Retention |
|---|---|
| Admin accounts | Until the admin deletes the account in-app (see §7) or we are instructed to delete it |
| Daily route codes | Expire automatically at end of day; archived for 30 days then deleted |
| Job records and photos | Retained for the operating period the customer (sign2site.com.au) requires for completion records; default 24 months, then deleted |
| Anonymous driver device ID | Stored only on the device; cleared when the app is uninstalled |
| Google OAuth tokens | Stored only on the admin's device; revoked when you disconnect or uninstall |

---

## 7. Your rights

You can ask us to access, correct, or delete personal data we hold about
you. To exercise these rights, email **bryanna@sign2sign.com.au**.

**Admin account deletion in the app.** Admins can permanently delete
their own account from inside the app: open **Account → Delete
account**, confirm, and the account plus its auth record is removed
immediately. Routes and jobs the admin created remain on the customer's
records (they belong to the operating entity, not to the admin
personally) — if you need those removed too, contact us.

**Drivers** have no account to delete. Uninstalling the app removes
everything on the device (the anonymous device ID and any cached
session). Photos and GPS already submitted to Supabase remain as part of
the customer's completion records.

Australian users: you may complain to the Office of the Australian
Information Commissioner (oaic.gov.au) if you believe we have mishandled
your personal information.

---

## 8. Children

Sign2Sign is a workplace tool. It is not directed at children and is
not intended for use by anyone under 16. We do not knowingly collect
data from children.

---

## 9. Security

- All network traffic uses HTTPS.
- Admin passwords are handled by Supabase Auth (bcrypt-hashed, never
  stored in our database in plain text).
- The driver code path is rate-limited at the edge function (per-IP) and
  at the database (per-device); successive incorrect codes are locked
  out.
- The Supabase service-role key never ships in the app. It exists only
  in the server-side edge function.
- Photo storage uses private buckets with row-level security policies;
  URLs to images are short-lived signed URLs generated at display time.

No system is perfectly secure. If you believe you've found a security
issue, please email **bryanna@sign2sign.com.au** rather than disclosing
it publicly.

---

## 10. Changes to this policy

If we make a material change to this policy, we will update the
"Last updated" date above and, for admins, surface a notice the next
time they sign in. The current version of this policy is always
available at the URL listed on the App Store page.

---

## 11. Contact

**Sign2Site Pty Ltd**
Perth WA 6031, Australia
Privacy enquiries: **bryanna@sign2sign.com.au**
