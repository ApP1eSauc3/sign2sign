# Windows code signing — options, costs, recommendation (2026-10-18)

The client asked for the admin app on Windows. The Electron shell already
builds for Windows (`electron-builder.yml` → `win`/`nsis`), but an unsigned
installer is not shippable to a non-technical office: Windows SmartScreen
shows "Windows protected your PC" and hides the install button behind a
"More info" link, and managed PCs may block it outright. This doc is the
evidence for picking a signing route and quoting it to the client.

Every external fact below carries its source and the date it was read.

## Background: how Windows decides to warn

- Since 2024, an EV certificate no longer skips SmartScreen. OV, EV and
  Microsoft's own Artifact Signing all build reputation the same way: new
  files can warn until they gather download history, and a **consistent
  signing identity** across releases lets later releases inherit it.
  (Microsoft, "Code signing options for Windows app developers", updated
  2026-08-29.)
- Since June 2023 the CA/Browser Forum requires code-signing private keys to
  live on a hardware token or HSM, so a "certificate file on the laptop" is
  no longer an option. (Same source.)
- Certificates issued from 2026-03-01 are valid for at most 460 days
  (CA/Browser Forum ballot CSC-31, adopted 2025-11-17), so a CA certificate
  is now a yearly renewal.

What the client should expect either way: the **first** signed releases may
still show a softer SmartScreen prompt that names "Sign2Site Pty Ltd" as the
publisher, until reputation builds. An unsigned installer shows "Unknown
publisher" every time, forever.

## Options

| Option | Cost | Who can get it | Works with our setup | Verdict |
|---|---|---|---|---|
| **Azure Artifact Signing** (formerly Trusted Signing), Basic | About US$9.99/month on a paid Azure subscription; 5,000 signatures/month; billed per month, not pro rata | Organisations in Australia (added 2026-07-23); individuals only in the USA/Canada | Yes: electron-builder 26 `win.azureSignOptions`, on a Windows CI runner | **Recommended** |
| OV certificate from a CA (Sectigo, SSL.com, DigiCert) | About US$129–550/year for the certificate (SSL.com US$129, Sectigo US$219, DigiCert US$549), plus key storage: a USB token (SSL.com YubiKey US$379) or the CA's paid cloud-signing subscription | Any registered business, worldwide | Yes, but a USB token needs a Windows PC with the token plugged in at every release | Fallback if Microsoft's validation fails |
| EV certificate | US$287–400+/year | Any registered business | Same as OV | Not worth the premium since 2024 |
| Microsoft Store (MSIX) | Free signing; no SmartScreen prompt | Worldwide | No: replaces our GitHub + electron-updater flow with Store review on every update, and changes how the app stores its data | Not recommended for a staff-only tool |
| Unsigned | Free | — | Builds today | Not shippable |

Sources: Microsoft code-signing options guide (2026-08-29); Artifact Signing
quickstart prerequisites ("Public Trust certificates are available to
organizations in the United States, Canada, the European Union, the United
Kingdom, Australia, …", page updated 2026-10-08); Microsoft Q&A 5834570,
Microsoft moderator 2026-07-23: "Starting today Artifact Signing is
available to organizations in Australia"; Microsoft Q&A 5977141, Microsoft
moderator 2026-08-17: "no minimum org age restrictions" (an AI-generated
answer in the same thread claiming a 3-year tax-history rule is wrong);
Artifact Signing FAQ (2026-10-06): paid subscription required, no
free/trial subscriptions, not pro rata, identity validation takes 1–20
business days; CA prices from SSL Dragon and SSL.com product pages
(2026-10-18); SSL.com OV product page (US$129/yr, YubiKey +US$379, read
2026-10-18); CA/Browser Forum ballot CSC-31 (460-day maximum from
2026-03-01).

Microsoft's code-signing options guide still lists only USA/Canada/EU/UK.
It is older than the quickstart and the moderator post; the quickstart is
the page the FAQ names as authoritative for eligibility.

## Recommendation: Azure Artifact Signing, in the client's name

1. **It must be the client's account and the client's name.** The
   certificate's publisher name is always the validated legal entity; a
   custom name is not allowed (Artifact Signing FAQ). The app belongs to
   Sign2Site, so the installer should say "Sign2Site Pty Ltd". This also
   matches the ownership-handover rule: accounts the client will own are
   created by the client.
2. **The client qualifies.** Public records checked 2026-10-18:
   - ABR: SIGN2SITE PTY LTD, ABN 44 656 835 988, active, postcode 6035 WA.
   - `.au` WHOIS for sign2site.com.au: registrant SIGN2SITE PTY LTD,
     registrant ID ABN 44656835988, eligibility type Company. Microsoft may
     ask for exactly this (domain registration listing the entity).
3. **It fits the release flow we already have.** The Mac app updates from
   GitHub Releases with electron-updater; the Windows build does the same
   with `latest.yml`. Signing inside electron-builder keeps the installer's
   checksum in `latest.yml` correct. Signing afterwards with a separate
   tool would break it.
4. **Signing needs Windows.** electron-builder 26 runs Microsoft's
   `TrustedSigning` PowerShell module (`windowsSignAzureManager.js` in
   node_modules) and Microsoft's GitHub action runs "only on Windows
   runners". The build therefore runs on GitHub Actions' Windows runner
   (`.github/workflows/windows.yml`), free for this public repo.

### What the client has to do (about 30 minutes plus Microsoft's review)

From the Artifact Signing quickstart (2026-10-08):

- Create a **paid** (pay-as-you-go) Azure subscription in Sign2Site's name.
- Create an Artifact Signing account (Basic) in a supported region. There is
  no Australian region yet (moderator, 2026-07-28); **Japan East** is the
  closest and matches where Supabase and Resend run.
- Submit an **Organisation** identity validation (Public):
  - legal name SIGN2SITE PTY LTD, website sign2site.com.au, business
    identifier = the ABN, business address;
  - a **primary email on sign2site.com.au** that someone reads (links expire
    after 7 days), and a **different secondary address on the same domain**
    (a shared/distribution address is accepted);
  - the name of a director or employee who then verifies their own identity
    with government ID through Microsoft Authenticator.
- After validation, create a **Public Trust** certificate profile, and give
  the developer a signing-only credential: an app registration with the
  "Artifact Signing Certificate Profile Signer" role. It can sign files and
  nothing else in their Azure account.

The developer then stores four values as GitHub secrets (`AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) and variables (endpoint, account,
profile, publisher name), and runs the Windows workflow.

## Quote line for the client

> Windows code signing (Microsoft Artifact Signing, Basic): about US$9.99 per
> month, billed by Microsoft to Sign2Site's Azure account. One-off setup:
> Sign2Site completes Microsoft's business identity check (1–20 business
> days). Without it, Windows warns staff that the installer is from an
> unknown publisher.

## If validation fails

Buy a one-year OV certificate with cloud key storage (SSL.com eSigner or
Sectigo cloud) in Sign2Site's name, and switch `azureSignOptions` to
`signtoolOptions` with the CA's signing tool. Same workflow otherwise.
