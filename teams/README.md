# Packaging the Teams tab

Sofra runs inside Teams as a personal tab: the app's own pages, rendered in
Teams, with the user already signed in. No bot, so no bot endpoint to host; the
only tenant consent needed is the sign-in scopes below.

## 1. Register an app in Entra ID (Azure AD)

- Expose an API → Application ID URI `api://<your-domain>/<client-id>`
- Add a scope `access_as_user`, admin and user consentable
- Pre-authorise the Teams clients so nobody sees a consent prompt:
  - `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams desktop and mobile)
  - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams web)
- API permissions → Microsoft Graph delegated: `openid`, `profile`, `email`
- Authentication → single-page application redirect URI `https://<your-domain>/`

## 2. Fill in the manifest

`manifest.json` uses `${{PLACEHOLDERS}}`. Substitute and zip:

```bash
SOFRA_BASE_URL=https://sofra.example.com \
SOFRA_DOMAIN=sofra.example.com \
AAD_CLIENT_ID=00000000-0000-0000-0000-000000000000 \
TEAMS_APP_ID=$(uuidgen) \
npm run teams:package
```

That writes `dist/sofra-teams.zip`. Upload it in Teams → Apps → Manage your apps
→ Upload an app.

## 3. Set the matching variables on the server

```
AAD_CLIENT_ID=...     # same app registration
AAD_TENANT_ID=...     # or 'common' for multi-tenant
```

The tab asks Teams for a token, the server verifies its signature against
Microsoft's published keys, and signs the user in as the colleague with that
email. A token that fails any check is refused. `src/lib/teams-auth.ts` is
where that happens, and the tests there cover a forged signature, a token for
another audience, an expired one and an unknown signing key.

## What this does not need

No bot registration, no `Chat.Create`, no application permissions, no admin
consent beyond the sign-in scopes. That is the point of the tab: the Teams
*group chat* for each table (`src/notify/channels/teams.ts`) is a separate,
heavier opt-in, and Sofra works without it.
