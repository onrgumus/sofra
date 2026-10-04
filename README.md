# Sofra

[![CI](https://github.com/onrgumus/sofra/actions/workflows/ci.yml/badge.svg)](https://github.com/onrgumus/sofra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

You can spend years in a building with people whose work you never see. Hybrid
work made it worse: you go in three days a week, sit with your own team, and
leave. Sofra spends an hour you were going to spend anyway on two or three
colleagues from other departments and levels, on a day you are all in the same
building.

People say which days they will be in their office and want lunch. Before the
office opens that morning, Sofra seats everybody who asked at tables of three or
four, mixing departments and seniority and never repeating a pairing, and sends
each table one invite with a calendar entry. Somebody who drops out has their
table reseated; somebody late takes a free seat.

It is built to be installed by a company, on its own infrastructure: one
PostgreSQL database, one Next.js server, a scheduler that calls it every fifteen
minutes, and optionally a Teams app on top.

## Why a company would run it

For the people at the table:

- **One press, no organising.** Mark a day, or set a weekly pattern once. No
  group chat, no poll, nobody who has to be the organiser.
- **People worth knowing.** Colleagues from other departments and levels, chosen
  because they have not met yet.
- **An easy first five minutes.** Every invite carries a topic and two or three
  openers drawn from what the table has in common.
- **Always their choice.** Opt in per day, drop out until the cut-off. Who asked
  for lunch is never reported to anyone, and neither are office days.

For the company:

- **Ties across teams.** People who have shared a table ask each other first.
  Projects later run on that informal network, and an org chart does not build
  it.
- **Faster onboarding.** Newcomers meet several teams in their first weeks, not
  only their own.
- **Office days that pay off.** Coming in buys something a video call cannot: an
  hour with people you would not otherwise meet.
- **It runs itself.** Employees serve themselves. An admin sets up an office
  once, and the scheduler makes the tables every morning after that.
- **The data stays inside.** Who works where, and who is in which building when,
  never leaves the company's own servers and database.

## How it works for somebody who uses it

1. They sign in. By an emailed link at a company address, with the company's
   identity provider, or automatically inside Teams. No passwords.
2. The first time, they say who they are for the purposes of a lunch: name,
   department (from the admin's list), team, level, the office they usually
   work in, the languages they are happy to eat in, a few interests.
3. Their calendar shows the next four weeks of their office's working days. One
   press per day: "I'm in, lunch please", with the office and lunch time for
   that day if they are going somewhere else. Days they are always in can be
   set once, weekly, and skipped for a single week.
4. The evening before, people likely to want lunch who have not said so are
   asked once: those who have eaten through Sofra recently, or whose Outlook
   says they will be in.
5. Before the office opens, the tables are made and the invites go out. Until
   the reply cut-off they can reply, drop out (the table is reseated) or join
   late (a free seat that keeps every rule). After it, nothing moves.

Who asked for lunch is never reported. The people at your table see your name,
title and department, and nothing else; an office's admins see the day's
requests and tables in the console; nobody else sees anything.

## When the tables are made

Every office has its own time zone and timetable, set in the console:

| Setting          | Example           | What it does                                                    |
| ---------------- | ----------------- | --------------------------------------------------------------- |
| Time zone        | `Europe/Istanbul` | Every time below is local to it. A place name, never an offset. |
| Opens            | 09:00             | Tables are timed from this.                                     |
| Make the tables  | 3 hours before    | So the invite is waiting before anybody arrives.                |
| Replies close    | 10:00             | After this nobody is moved.                                     |
| Evening question | 16:00             | On the previous working day: Friday for a Monday.               |
| Lunch times      | 12:00, 12:30      | People pick one or say any; short times are filled first.       |
| Working days     | Mon–Fri           | Plus a list of holidays, when nothing is planned.               |
| Table size       | 3 to 4            |                                                                 |

There is no fixed schedule anywhere. A scheduler calls `/api/cron/tick` every
fifteen minutes, and on each call Sofra works out, for each office in its own
zone, whether the moment for making a day's tables or asking about tomorrow has
come, and does whatever is due and not yet done:

```
                 Istanbul (UTC+3)      Amsterdam (UTC+2 / UTC+1)     New York (UTC-4 / UTC-5)
opens 09:00      tables 06:00 local    opens 08:30, tables 05:30     opens 09:00, tables 06:00
                 = 03:00 UTC           = 03:30 / 04:30 UTC           = 10:00 / 11:00 UTC
```

So a new office needs nothing added to any scheduler, and a clock change moves
nothing that should stay put. Every scheduled job is claimed with an insert that
only one caller can win, so a tick that runs twice, late, or on two instances at
once does each job exactly once, and a building is never mailed twice. A job
that fails is retried on later ticks, up to three times; one that was due while
the scheduler was down is still run if lunch has not started, and recorded as
skipped if it has. Every run, and why, is in the console.

## What the matcher optimises for

Seating four strangers together is a max-weight set packing problem, which is
NP-hard. Sofra uses greedy construction seeded from the hardest-to-place person,
then 2-opt local search. On pools under ~500 it runs in milliseconds and lands
close enough to optimal that the difference is not something a human at a lunch
table could perceive.

Hard rules: same building, day and lunch time; no two people from the same
immediate team; nobody re-matched inside the cooldown window; every table shares
a language. Soft score: spread of departments, spread across the seniority
ladder, tenure gap, a shared interest as an opener, and novelty.

Nobody eats alone. If the pool is too homogeneous to honour every rule, the
matcher walks a relaxation ladder (`none` → `allow-repeat` → `allow-same-team`)
and takes a penalty rather than turning someone away. Everyone is split evenly
into tables within the office's sizes, so a pool of 11 becomes `[4, 4, 3]`,
never two tables and one person left standing in the lobby. The rare person who
genuinely cannot be seated (too few asked, or nobody shares a language with
them) is told which, once.

When declines drop a table below its minimum, whoever still wants lunch is moved
to another table with room and no rule broken. A receiving table may go one over
its maximum for that sitting, because a slightly crowded table beats sending
somebody away, and its calendar invite goes out again with a higher `SEQUENCE`,
which is how every calendar client updates the event people already accepted
instead of adding a second one.

Try the engine on its own, without a database:

```bash
npm run simulate
```

## Invites

One mail to the whole table, not four separate notes: everyone sees the same
names at the same moment and can reply to each other. It carries an RFC 5545
`.ics` with the lunch as an instant in the office's zone, accepted by Outlook,
Google and Apple calendars alike, and needing nobody's calendar write
permission. It has an introduction round, a topic for the table, icebreakers
from what the people at it share, and a closing request not to turn it into a
work meeting. It is written in a language everyone at the table speaks (`en` and
`tr` ship).

Where a company has Teams, the same invite also arrives as a card from the Sofra
bot with the reply buttons on it, and as an activity-feed notification. Slack
gets a group message. Email always goes, because it needs nobody's permission.

## Signing in

There are no passwords anywhere.

- Emailed link. Somebody types their work address; if its domain is allowed (or
  they are already here, or a bootstrap admin), a link goes to it. The link
  works once, for fifteen minutes; asking again retires the old one. It opens a
  page with a button rather than signing in on sight, because corporate mail
  scanners open every link in incoming mail. The form answers the same whether
  or not the address can sign in, so it cannot be used to find out who works
  somewhere, and it is rate limited per address and per network address in the
  database, so the limit holds across instances.
- Company identity provider. Entra, Okta, Google Workspace or Auth0, by issuer
  URL: authorization code with PKCE, state and nonce, and the id token's
  signature, issuer, audience and lifetime checked before anybody is looked up.
  An address the provider has not verified is not trusted.
- Teams. The tab asks Teams for a token and the server verifies it against
  Microsoft's published keys. Somebody new from the configured tenant gets a
  profile to fill in; nobody has to be imported first.

Sessions are server-side: the cookie holds a random 256-bit token, the database
holds only its hash, and it is HttpOnly, Secure and SameSite (partitioned inside
a Teams iframe). Every sign-in makes a new one. A session lasts thirty days;
signing out deletes it; "sign out everywhere" and deactivating a person delete
all of theirs. Deactivated people cannot sign back in by any route.

### Admins

`SOFRA_ADMINS` names the first admins by address. Everyone after them is granted
in the console, either for every office or for particular offices. An office
admin sees that office's console, timetable, holidays and runs, and nothing
else; company settings, people and grants belong to every-office admins. The
console asks for a sign-in within the last twelve hours, so a laptop left open
for a month cannot re-plan a building's lunch. Its pages return 404 to anyone
else, its actions check the same rights again on the server, and every change is
written to an audit log nobody can edit.

## The console

- Day: for an office and a date, who asked, the tables with their scores and
  replies, who could not be seated, what the scheduler did, and buttons to make
  the tables now (re-planning cancels the invites already sent and sends new
  ones) or ask the evening question now.
- Offices: create and edit offices, their timetable in their own zone with the
  UTC beside it, and their holidays.
- People: search, move somebody to another office, sign them out everywhere,
  deactivate them, make them an admin.
- Settings: company name, allowed mail domains, the department list.
- Runs: every scheduled and manual job, its result and its reason.
- Audit log.

## Running it on a laptop

You need Node 20+ and PostgreSQL.

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL, and SOFRA_ADMINS=onur@sofra.test
npm run db:seed                   # two offices, 241 invented people at @sofra.test
npm run dev
npm run scheduler                 # in a second terminal: the tick, every minute
```

The seed is a company that has been using Sofra for three weeks: past tables,
replies and evening questions, made by the scheduler's own code, and requests
for the coming twelve days. `npm run db:seed -- --reset` starts it over from
today, which is the way to get a fresh week before showing it to anybody.

Open http://localhost:3000, sign in as `onur@sofra.test`, and follow the link
from http://localhost:3000/dev/mailbox: in development, mail is kept in the
database and shown there instead of being sent (`SOFRA_MAIL_TRANSPORT=outbox`).
Any seeded person can sign in the same way.

`npm run dev` always takes port 3000, the port in `SOFRA_BASE_URL`, and stops
with `EADDRINUSE` if something already holds it. It does not move to 3001: sign-in
links would then point at the wrong server, and two dev servers share one
`.next` folder, so each breaks the other's pages.

`npm run scheduler` calls the tick every minute, as a company's scheduler does
every fifteen, so each office's tables and evening question arrive on their own
at the office's hour. Without it nothing happens by itself. To run a tick once:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

or press "Make the tables now" in the console.

## Installing it in a company

Sofra is installed by a company, not subscribed to: the input is who works where
and who is in which building when, which is exactly the data a company will not
hand to a third party. One instance serves one company.

For a company on Microsoft, the natural home is Azure App Service (or Container
Apps) with Azure Database for PostgreSQL:

1. Create the database and set `DATABASE_URL`. Migrations run on the first
   query, under a lock; `npm run db:migrate` runs them as a release step
   instead.
2. Deploy the app (`npm run build`, `npm start`) with the variables below.
   `/api/health` answers when the process and the database both do.
3. Point a scheduler at `/api/cron/tick` every fifteen minutes with
   `Authorization: Bearer $CRON_SECRET`: an Azure Logic App or Container Apps
   job, a Kubernetes CronJob, or a line in crontab:

   ```cron
   */15 * * * * curl -fsS -H "Authorization: Bearer <CRON_SECRET>" https://sofra.company.com/api/cron/tick
   ```

   Sofra does not schedule itself, and the repository carries no host's cron
   configuration: nothing runs until something calls the tick. Vercel's free
   plan runs cron jobs at most once a day, too seldom for any office's morning;
   on Vercel, a Pro plan's cron or an outside scheduler does it.

4. Choose how mail goes out: the company's SMTP relay, Microsoft 365 through
   Graph (`Mail.Send`, ideally restricted to one mailbox), or Resend.
5. Sign in as a bootstrap admin, create the offices, the departments and the
   allowed domain. People can start signing in.
6. Optionally, the Teams app: [teams/README.md](teams/README.md).

### Optional integrations

| Integration        | Turned on by                   | Needs                                          |
| ------------------ | ------------------------------ | ---------------------------------------------- |
| Company sign-in    | `SOFRA_OIDC_ISSUER`            | An OIDC client                                 |
| Teams tab          | `AAD_CLIENT_ID`                | An app registration, no admin consent          |
| Teams bot          | `TEAMS_BOT_ID`                 | An Azure Bot on the same registration          |
| Activity feed      | `TEAMS_APP_ID` + `MS_*`        | `TeamsActivity.Send`                           |
| Directory sync     | `SOFRA_DIRECTORY=entra` or csv | `User.Read.All`, or an export                  |
| Outlook hints      | `SOFRA_CALENDAR_HINTS=outlook` | `Calendars.Read`                               |
| Microsoft 365 mail | `SOFRA_MAIL_TRANSPORT=graph`   | `Mail.Send`                                    |
| Slack              | `SLACK_BOT_TOKEN`              | `mpim:write`, `chat:write`, `users:read.email` |

None of them is needed. People fill in their own profile, pick their own days,
and get their invites by mail.

The directory sync, when on, runs every six hours: new people arrive with what
the directory knows filled in and confirm the rest on first sign-in; people
already here have their name, title, department and team updated but keep what
they chose; people the directory no longer has are deactivated and signed out,
unless the read suddenly lost half the company, in which case nothing is
deactivated and the run says why.

Outlook office days are a hint, never a request: being in the building is not
wanting lunch. They show as a badge on the calendar and decide who gets the
evening question.

## Configuration

See [.env.example](.env.example) for every variable with its explanation. The
ones every deployment sets:

| Variable               | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL.                                                                |
| `SOFRA_BASE_URL`       | The public address; links in mail carry it.                                |
| `SOFRA_ADMINS`         | The first admins, by address.                                              |
| `CRON_SECRET`          | The scheduler's secret for `/api/cron/tick`.                               |
| `SOFRA_SESSION_SECRET` | Signs the company sign-in handshake. Production refuses to run without it. |
| `SOFRA_MAIL_TRANSPORT` | `smtp`, `graph` or `resend` in production.                                 |
| `SOFRA_FROM_EMAIL`     | The sender of invites and sign-in links.                                   |

## No special-category data, anywhere

Sofra holds no gender, no age, and no dietary information. Balancing tables by
gender, or printing dietary needs in an invite that goes to three colleagues,
would put special-category data under GDPR and KVKK into an automated
employment process, and publish somebody's religion or health to people who
never needed to know. The diversity that makes the lunch worth having comes from
department, team, seniority and tenure instead. Tests assert that the score has
no gender term and the invite never mentions food. See
[docs/privacy.md](docs/privacy.md) for what is stored and why.

## Project layout

```
src/core/       the matching engine, pure: no I/O, no framework
src/db/         the pool and the migrations
src/data/       every query, one module per table group
src/services/   scheduling, planning, delivery, reminders, sign-in forms, integrations
src/auth/       sessions, emailed links, roles
src/teams/      the bot: verification, cards, handling, delivery
src/notify/     invite content, the calendar file, mail transports and channels
src/directory/  Entra and CSV readers for the optional sync
app/            Next.js pages, server actions and API routes
scripts/        seed, migrate, the end-to-end walk, the Teams package
teams/          the Teams manifest, icons and setup guide
```

## Quality

```bash
npm run typecheck   # tsc, strict
npm run lint        # eslint, zero warnings
npm run format      # prettier
npm test            # against a real PostgreSQL: TEST_DATABASE_URL, or .env.test.local
npm run e2e         # the whole product on a fake clock, against PostgreSQL
npm run build
```

The tests run against PostgreSQL, not a stand-in: each test file works in a
fresh schema of its own, so they run in parallel and the SQL under test is the
SQL that runs in production. `npm run e2e` walks the product from an empty
company to a finished lunch: sign-in by link, profiles, requests and a weekly
pattern, the evening question, the morning tables, the scheduler running twice
at once, a drop-out reseated, a latecomer seated, four replies at the same
instant, the cut-off, and a clock change. CI runs all of it on every push.

## Licence

MIT.
