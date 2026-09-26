# Sofra as a Teams app

Sofra runs inside Teams as a personal tab, its own pages rendered in Teams with
the person already signed in, and optionally as a bot that brings each
invitation and the evening question into the person's chat as a card they can
answer in place.

The tab needs no admin consent at all. Somebody who opens it for the first time
is signed in by Teams, and if they are new, asked for their office, department
and the rest; nothing has to be imported first. Set `SOFRA_TEAMS_ONLY=true` and
Teams is the only way in: no emailed link, no company sign-in button, no sign-out,
and opening the address in a browser says Sofra lives in Teams and links there.
The tab follows the Teams theme, light or dark.

The server is the same one described in the [main README](../README.md): the
Teams app is a manifest pointing at it.

## What it takes

- A Microsoft 365 tenant where you may upload a custom app. In Teams, Apps →
  Manage your apps → Upload an app: if "Upload a custom app" is there, you can.
  If only "Submit an app to your org" is, an admin has turned it off and the
  upload goes to them for approval. The free, personal Teams cannot do either.
- An app registration in that tenant's Entra ID, which by default any member may
  create.
- The server on an `https://` address that does not change.

## 1. Register the app in Entra ID

App registrations → New registration.

1. Name it Sofra. Supported accounts: this organizational directory only. No
   redirect URI.
2. Manifest: set `requestedAccessTokenVersion` to `2` (`accessTokenAcceptedVersion`
   in the older format) and save. A new registration issues v1 tokens, which
   Sofra refuses; the server log says so in those words when this was missed.
3. Expose an API → Application ID URI: `api://<host>/<client id>`, with the host
   from `SOFRA_BASE_URL`, in lowercase.
4. Add a scope named `access_as_user`, consentable by admins and users.
5. Add two authorized client applications, each with that scope ticked, so nobody
   is ever shown a consent prompt:
   - `1fec8e78-bce4-4aaf-ab1b-5451cc387264`, Teams desktop and mobile
   - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346`, Teams web

On the server:

```
AAD_CLIENT_ID=<the client id>
AAD_TENANT_ID=<the tenant id>
TEAMS_APP_ID=<run uuidgen once, and keep it>
SOFRA_TEAMS_ONLY=true
```

With a specific tenant, everybody Teams signs in from it may use Sofra. With
`common`, only addresses at an allowed domain may.

## 2. The bot (optional)

The bot needs no permission beyond itself. In the Azure portal, create an Azure
Bot:

- Type of app: single tenant, using the app registration from step 1 (or a new
  one), with a client secret.
- Messaging endpoint: `https://<host>/api/teams/messages`.
- Channels: add Microsoft Teams.

On the server:

```
TEAMS_BOT_ID=<the bot's Microsoft App ID>
TEAMS_BOT_PASSWORD=<its client secret>
TEAMS_BOT_TENANT_ID=<the tenant id>
```

When `TEAMS_BOT_ID` is the same client id as `MS_CLIENT_ID`, its secret and
tenant are taken from `MS_*` and need not be repeated.

Every request to the endpoint must carry a token the Bot Framework signed for
this bot and for the conversation's service; replies are only ever sent to
Microsoft's Bot Framework hosts. A card's buttons say which table or day, never
who: the bot acts as the person the verified activity says clicked. A person the
bot has not heard from yet still gets everything by mail.

## 3. Package and upload

```bash
npm run teams:package
```

It reads `SOFRA_BASE_URL`, `AAD_CLIENT_ID`, `TEAMS_APP_ID` and, if set,
`TEAMS_BOT_ID` from the environment or `.env.local`, refuses anything that would
upload fine and then not work (an `http://` address, an id that is not a GUID),
and writes `dist/sofra-teams.zip`. In Teams: Apps → Manage your apps → Upload an
app → Upload a custom app, pick the zip, Add, Open.

A change to the code needs a deploy, not a new upload. A change to the manifest
needs a new upload with the same `TEAMS_APP_ID` and a higher `version`, or Teams
installs a second Sofra next to the first.

## 4. More from Microsoft 365 (optional)

One app-only registration (`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`)
switches on the rest, each by its own setting and each with an application
permission an admin grants once:

| For                          | Setting                        | Permission                                 |
| ---------------------------- | ------------------------------ | ------------------------------------------ |
| Activity feed notifications  | `TEAMS_APP_ID`                 | `TeamsActivity.Send`                       |
| People synced from Entra     | `SOFRA_DIRECTORY=entra`        | `User.Read.All` (+ `GroupMember.Read.All`) |
| Office days from Outlook     | `SOFRA_CALENDAR_HINTS=outlook` | `Calendars.Read`                           |
| Mail sent from Microsoft 365 | `SOFRA_MAIL_TRANSPORT=graph`   | `Mail.Send`                                |

`SOFRA_ENTRA_GROUP_ID` limits the directory sync to one group, which is how a
pilot runs: IT creates a group and nobody outside it is brought in. Each office's
location keywords, set in the console, are what recognise it in Entra's
`officeLocation` and in Outlook entries.

## Trying it from a laptop

The tab is loaded by the Teams client on your own machine, so `https://localhost`
works and never changes address: register once, upload once, then edit and
reload.

```bash
cp .env.teams.example .env.teams.local
```

Put a GUID from `uuidgen` in `TEAMS_APP_ID`, do step 1 with `localhost:3443` as
the host (Application ID URI `api://localhost:3443/<client id>`), and put the
client and tenant ids in the file. Then:

```bash
npm run dev:teams
npm run teams:package:local
```

The first run creates a local certificate and asks for your password to trust
it. Use Teams on the web in Edge or Chrome for the first try. Nobody else can
open a tab served from your laptop; for colleagues, deploy the server.

## When it does not work

| What you see                                                          | Why                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Teams says it cannot reach the app                                    | The server is not answering on `SOFRA_BASE_URL` over HTTPS, or the package was built for another address.  |
| "Teams could not sign you in", and the log mentions a v1 token        | Step 1.2.                                                                                                  |
| "Teams could not sign you in", and the log says another application   | `AAD_CLIENT_ID`, the Application ID URI and the package disagree.                                          |
| A consent prompt, or "Need admin approval"                            | Step 1.5 is missing a client, or the scope was not ticked for it.                                          |
| "Your Teams account is not in this company directory"                 | `AAD_TENANT_ID` is `common` and the address is not at an allowed domain, or the person was deactivated.    |
| "Teams signed you in, but this Teams client did not keep the session" | That Teams client blocks cookies inside apps. Try Teams in Edge or Chrome.                                 |
| No cards from the bot                                                 | The person has not opened the bot yet, or the Azure Bot's messaging endpoint is wrong. Mail still arrives. |

## Giving it to the company

An admin uploads the same zip in the Teams admin center, under Teams apps →
Manage apps → Upload new app, which puts it in the company's own catalogue. A
setup policy then installs and pins it for the pilot group, so nobody has to go
looking for it.
