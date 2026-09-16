# Sofra

[![CI](https://github.com/onrgumus/sofra/actions/workflows/ci.yml/badge.svg)](https://github.com/onrgumus/sofra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

You can spend years in a building with people whose work you never see. As more
of the routine gets automated, what is left is the part that runs on knowing who
to ask, and that is not on any org chart. Sofra spends an hour you were going
to spend anyway on three people most likely to teach you something.

Hybrid work made it worse: you go in three days a week, sit with your own team,
and leave. Sofra puts three or four people who would never otherwise meet at the
same lunch table on a day they are all already in the building.

Being in the office is not the signal. Most office days you are there to work
with your own team, and that is fine. Sofra does nothing unless you tick a box
for that specific day saying you would rather meet people from other teams.

It works at any company, because it never integrates with your desk-booking
tool.

## The idea that makes it portable

Every company uses a different desk-booking app: Envoy, Robin, deskbird,
Condeco, OfficeSpace, or a homegrown spreadsheet. Integrating with all of them is
a losing game.

Sofra does not try. It asks one question, and every system on earth can answer it:

```ts
interface AttendanceProvider {
  getAttendance(query: { date: string; officeId: string }): Promise<AttendanceRecord[]>;
}
```

Who is in this building on this day? That is the entire integration surface.

| Provider                      | Integration cost | Where it fits                                                                                                       |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ManualAttendanceProvider`    | none             | Every company, day one. People just tell the app.                                                                   |
| `MsGraphAttendanceProvider`   | low              | Most desk tools write the booking back to Outlook, so reading Outlook covers them all without touching any of them. |
| `CsvAttendanceProvider`       | low              | IT can always produce a CSV, even when procurement will not approve an API.                                         |
| `WebhookAttendanceProvider`   | low              | For desk tools that can push.                                                                                       |
| `CompositeAttendanceProvider` | none             | Real rollouts are mixed. Union the sources; one being down does not cancel lunch.                                   |

Start with `Manual`, add a real feed once the habit exists.

## Why not just use a Teams channel

You can, and for a small office you should. A `#lunch` channel where people post
"I'm in today" costs nothing and works fine at twenty people.

It breaks at two hundred, for two reasons. Somebody has to group everyone by
hand, every day. And self-organising reproduces the cliques it was meant to
break: people reply to the people they already know, which is the exact failure
this is supposed to fix.

There are also existing products in this category: Donut for Slack,
Microsoft's own open-source Icebreaker for Teams, RandomCoffee, Mystery
Minds. They pair people at random for a coffee, usually weekly, usually 1:1.

Sofra differs in one constraint, and everything else follows from it: it only
matches people who are already in the same building on the same day. A random
pairing with someone working from home that day becomes a video call, which is
the thing hybrid workers are already tired of. Because the constraint is
physical presence, the product needs an attendance signal, which is why the
provider abstraction is the first thing in this README rather than a footnote.

Three smaller differences: tables of three or four rather than pairs, because a
1:1 with a stranger is an interview and a table lets you listen; lunch, which is
an hour that already exists in the day rather than a new calendar commitment;
and a tick per day rather than standing enrolment that pairs you in a week when
you have no appetite for it.

When not to bother: fewer than about forty people in one office, a fully remote
company (the attendance signal does not exist, and Donut fits better), or a
culture where nobody will tick the box. No app fixes that last one.

## What the matcher optimises for

Seating four strangers together is a max-weight set packing problem, which is
NP-hard. Sofra uses greedy construction seeded from the hardest-to-place person,
then 2-opt local search. On pools under ~500 it runs in milliseconds and lands
close enough to optimal that the difference is not something a human at a lunch
table could perceive.

Hard rules: same building and day, no two people from the same immediate
team, nobody re-matched inside the cooldown window, and every table must share a
language.

Soft score: spread of departments, spread across the seniority ladder,
tenure gap, at least one shared interest as an opener, and novelty.

Nobody eats alone. If the pool is too homogeneous to honour every rule, the
matcher walks a relaxation ladder (`none` → `allow-repeat` → `allow-same-team`)
and takes a penalty rather than turning someone away. Everyone who ticked the box
is split evenly into tables of three or four, so a pool of 9 becomes `[3, 3, 3]`
and a pool of 11 becomes `[4, 4, 3]`, never two tables and one person left
standing in the lobby. "No match was found for you" is the one email that would
kill this product, so the engine is built so it cannot be sent.

And nobody is stranded by other people's plans. The invite says "let us know
by 10:00 so we can reseat the table", so it reseats. When declines drop a table
below three, whoever still wants lunch is moved to another table that day with
room and no rule broken; only if there is genuinely nowhere to put someone do
they hear the lunch is off. A receiving table may go to five for that one
sitting, because a slightly crowded table beats sending somebody away, and its calendar
invite goes out again with a bumped `SEQUENCE`, which is how every calendar
client updates the event people already accepted instead of adding a second one.

## Try it

No database, no API keys, no infrastructure:

```bash
npm install
npm run simulate
```

This generates a synthetic 240-person company and runs eight weekly lunches:

```
seated               320/320 opt-ins (100.0%)
table sizes          3p x12  4p x71
cross-department     81.8% of pairs
seniority levels     3.04 distinct per table
repeat pairings      0/462 pairs met more than once
rules bent           none x83
```

Every opt-in got a seat, 82% of the people sitting together came from different
departments, and across eight weeks no pair was ever seated together twice. The
average table score declines week over week. That is the novelty budget being
spent, and it is the signal that tells you when to widen the pool.

It then prints a real invite, generated from the actual match:

```
subject: Lunch today at 12:00, the four of you

The 4 of you are having lunch together at 12:00 today. You work at the same
company, you are all in the building, and none of you have had lunch together
before. This mail went to all 4 of you at once, so just reply here to sort out
where you are going.

Where
Istanbul HQ — Ground floor cafeteria, by the coffee bar

Who
• Selin Kaya — Intern, Sales (SMB)
• Omar Demir — Manager, Product (Growth)
• Elif Novak — Associate, Engineering (Mobile)
• Quinn Schmidt — Specialist, Design (Research)

How to start
Go round the table before you order. Everyone answers:
• How long you have been here, and what you actually do day to day
• Which project you are on right now
• What you were doing in your career before this job
• Your hobbies, and what you spend time on when you are not here
• What would make you happier about coming into the office
• One thing you genuinely think we could be doing better

Today's topic
The part of your job that would surprise someone outside your department.

If the conversation stalls
• You all put "photography" on your profile. Start there.
• Sales, Product, Engineering, Design are at this table. What does each of you
  think the others actually do all day?

And do not let it turn into a work meeting
Leave room for the rest of it: sport, music and films, the city, where you grew
up, what you actually care about. You can get a status update over Slack. The
point of this table is the people sitting at it.
```

Flags: `--size`, `--weeks`, `--participation`, `--seed`, `--office`.

## Invites

One mail to the whole table, not four separate notes. Everyone sees the same
names at the same moment, can reply to each other beforehand, and nobody has to
wonder whether the others got it.

It carries an introduction round: how long you have been here, what you
actually do, the project you are on, what you did before this job, your hobbies,
what would make the office better, and one thing we could genuinely be doing
better. Then a topic for the table, picked stably per group so re-sending
does not change what people turned up prepared for, and varied across tables so
four departments are not all having the same conversation.

It closes by telling the table not to spend the hour on work. Left alone,
four colleagues will produce a status meeting with food; the mail explicitly asks
for sport, music, the city, where people grew up, what they care about.

### Slack and Teams

Where a company has them, the invite is better delivered where people already
are. What that looks like differs sharply between the two, and the difference is
not a matter of effort.

Slack gets a group chat. `conversations.open` with the four user ids returns a
multi-person DM, and the docs confirm it is idempotent for the same set of
people, so re-sending an updated invite posts into the chat that already exists
rather than starting a second one. "Shall we try the new place instead" then
happens where the plan was made. A plain bot token does it: `mpim:write`,
`chat:write`, `users:read.email`.

Teams does not, and cannot. Two facts from Microsoft's own reference close off
the obvious routes:

- `POST /chats/{id}/messages` has one application permission,
  `Teamwork.Migrate.All`, which exists for importing history into a chat in
  migration mode. The higher-privileged column reads "Not available", so a cron
  holding client credentials cannot post a chat message.
- A bot does not rescue it: "You can't create a new group chat or a new channel
  in a team with proactive messaging."

What does work app-only is the activity feed.
`POST /users/{id}/teamwork/sendActivityNotification` has the application
permission `TeamsActivity.Send`, so each person at the table gets a notification
that opens the Sofra tab, where the names and the RSVP buttons already are. Four
notifications instead of one shared conversation is a real loss next to Slack,
and it is the best Teams allows on a schedule.

| Channel                | What it does                                                          | What it costs                                    |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| `EmailChannel`         | One mail to the table, `.ics` attached                                | nothing, always on                               |
| `SlackChannel`         | A group DM with the four, then a Block Kit post with a confirm button | a bot token                                      |
| `TeamsActivityChannel` | An activity feed notification each, deep-linked to the tab            | `TeamsActivity.Send`, and the tab installed      |
| `TeamsChannel`         | `POST /chats`, then an Adaptive Card                                  | a bot or delegated backend; app-only cannot post |
| `CompositeChannel`     | All of the above; one being down does not stop the others             | none                                             |

`TeamsChannel` is kept because the shape is right and a delegated backend slots
in behind the same `graph` function, but it refuses app-only credentials up
front rather than opening four chats it cannot post into.

### The calendar invite

An RFC 5545 `.ics` with `METHOD:REQUEST` rather than a call to the Teams or
Google Calendar API. An `.ics` is accepted by Outlook,
Teams, Google Calendar and Apple Calendar alike, and needs no tenant admin
consent, no per-company app registration and no calendar write scope, which is
the whole point of a tool that has to work everywhere.

Icebreakers are derived from the table itself: a shared interest first, then the
widest gap in the room. The invite is written in a language everyone at the table
speaks (`en` and `tr` ship; the matcher guarantees at least one is shared).

## No special-category data, anywhere

Sofra holds no gender, no age, and no dietary information.

The obvious version of this product balances each table by gender, and prints
everyone's dietary needs in the invite. Sofra does neither.

Automated grouping by gender or age in an employment context invites both
GDPR/KVKK scrutiny and discrimination claims, and European works councils will
block it outright. Dietary needs are worse: they reveal religion and health,
explicitly special categories under GDPR Art. 9 and KVKK Art. 6. And this mail
goes to three colleagues at once, so printing "halal" next to somebody's name
publishes it to people who never needed to know. The table sorts the venue out by
replying to each other instead.

None of it turns out to be a loss. The diversity that makes the lunch worth
having comes from department, team, seniority and tenure, all already in the org
chart, all with an obvious business justification, none of them a protected
characteristic. Tests assert that the score has no gender term and that the
invite never mentions what anyone eats. See [docs/privacy.md](docs/privacy.md).

## What is here, and what is not

Built and tested: the matching engine, the provider abstraction with five
implementations, ICS generation, bilingual invite content with topics, the email
transport layer, the simulator, the nightly job, and a Next.js app: per-day
opt-in, a matching console that shows the score behind every table, and the
confirm-by-10:00 flow that reseats people when a table collapses, and a Teams tab. 151 tests.

Run it with `npm run dev` and sign in as onur / 1234, or take a random
colleague from the same screen. A shared link means several people clicking at
once, and they should not all be ticking the same boxes. The app is seeded with
a synthetic company through an in-memory store, so it needs no database and no
API keys.

Dates are resolved in each office's own timezone rather than the server's, since
Istanbul and Amsterdam are on different dates for part of every day.

Not built yet: real authentication and persistence.

Sign-in is one shared password so anyone with the link can try the product: a
demo gate, not authentication, though the session cookie is HMAC-signed so an
employee id cannot be forged in devtools. Replacing `src/lib/auth.ts` and
`src/lib/session.ts` is the whole of adding real sign-in.

Persistence is a connection string away. Set `DATABASE_URL` and state lives in
Postgres, which is what a serverless deployment needs: the filesystem on Vercel
is ephemeral, so a file would be empty on every cold start. Set
`SOFRA_DATABASE` instead and it is SQLite, which ships with Node and is the
right answer on one machine.

This was not a tidy-up. Measured against a production build before the store
existed: restart the server and every tick, reply and table was gone, and
because "this invite was already sent" was memory too, the next cron run mailed
nine of sixteen tables the identical invite a second time. With the database,
the same restart finds sixteen tables, sends zero invites and mails nobody.

All three stores are held to one suite. `tests/store-contract.test.ts` runs the
same cases against the in-memory, SQLite and Postgres implementations, so a
disagreement between them fails the build instead of waiting for production to
find it.

By default Postgres runs against pg-mem, which parses the real dialect in
process. That catches the SQL a port gets wrong, and it caught two here, but it
is single-threaded: it accepts `FOR UPDATE` and never contends on it, so the
concurrency case is skipped and says why rather than passing and meaning
nothing. Point `TEST_DATABASE_URL` at a server and it runs for real:

```bash
TEST_DATABASE_URL=postgresql://localhost/sofra_test npm test
```

Verified that way against PostgreSQL 16, which is also how the last real bug
turned up: inside a transaction every query shares one client, and a pg client
cannot run two at once, so the `Promise.all` reads in the store were the
deprecation warning pg prints and the undefined behaviour behind it.

The locking matters because a reply is a read-modify-write across every table
that day. SQLite gets its atomicity from doing that synchronously; Postgres
cannot, so the day is locked for the duration of a reply. On a serverless
platform an in-process mutex would be useless anyway, since the next reply may
land on a different instance.

The nightly job is idempotent for the same reason. A day that already has tables
is not re-planned, because a platform retry or a second schedule would otherwise
rebuild identical tables whose invites had not been sent and mail the whole
building again. The console's re-run button asks for that explicitly.

Two things guard the parts that are not about your own lunch. `SOFRA_ADMINS`
names who may open the matching console, which shows every table and every
reply for a whole office and whose buttons re-plan the day and mail everyone in
it; empty means nobody, because an unconfigured deployment should refuse rather
than hand that to the first person who signs in. The page and the three actions
are checked separately, since guarding only the page leaves them callable
directly. `SOFRA_DEMO_MODE` controls the account switcher, which is the point of
a public demo and impersonation in a company: off in production unless asked
for.

Still missing before this is a product: real authentication, and a directory
sync in place of the synthetic company. Sign-in is one shared password so
anyone with the link can try it, a demo gate rather than authentication, though
the session cookie is HMAC-signed so an employee id cannot be forged in
devtools. Replacing `src/lib/auth.ts` and `src/lib/session.ts` is the whole of
the first; reference data is already injected into the store rather than stored
by it, which is most of the second.

## The nightly job

Matching is not something anyone should have to remember to press. `GET
/api/cron` plans the next working day for every office and mails one invite per
table; `vercel.json` schedules it for 17:00 on weekdays, and any scheduler that
can send a header will do.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-instance/api/cron
```

```json
{
  "ranAt": "2026-09-12T18:10:00.415Z",
  "offices": [
    {
      "officeId": "IST-HQ",
      "date": "2026-09-14",
      "optedIn": 27,
      "tables": 7,
      "seated": 27,
      "unseated": 0,
      "invitesSent": 7
    },
    {
      "officeId": "AMS-1",
      "date": "2026-09-14",
      "optedIn": 35,
      "tables": 9,
      "seated": 35,
      "unseated": 0,
      "invitesSent": 9
    }
  ]
}
```

Without `CRON_SECRET` set the endpoint refuses to run rather than running
openly. Anyone who could reach it would be able to reshuffle tomorrow's tables
and mail the whole company. The admin console's button calls exactly the same
`planDay`, so what you see there is what the cron produces.

## Who runs this

Sofra is built to be installed by a company, not subscribed to. One instance
serves one company: its database, its hosting, its Entra app registration, its
mail. That is not an accident of how far it has got. The product's whole input
is who is in which building today and who works for whom, which is exactly the
data a bank will not hand to a third party, and the Outlook feed needs
credentials inside their tenant anyway. Self-hosting removes a procurement
conversation rather than starting one.

So there is no notion of a tenant anywhere in the domain model, and adding one
would not be a small change: every table would need a tenant column and row
level security, offices and credentials would become per-tenant records rather
than configuration, and sessions would have to be scoped. If you want a
multi-tenant SaaS, that is the work, and it is worth deciding before rather than
after.

Nothing here is tied to Vercel. `vercel.json` only schedules the cron, and the
job is an ordinary authenticated `GET /api/cron`: Azure Container Apps with a
timer, a Kubernetes CronJob, or a line in crontab all do the same thing. For a
company already on Microsoft, which a company using Teams is, Azure Database for
PostgreSQL and App Service is the more likely pairing than anything in this
repo's examples.

The public demo is the exception. It runs on somebody's personal Supabase and
Vercel because its job is to be clickable from a link, and it holds nothing but
a synthetic company.

## Configuration

Copy `.env.example` to `.env.local`.

| Variable           | What it does                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `SOFRA_BASE_URL`   | Public URL of this instance. The confirm link goes into an email, so it cannot be relative. |
| `CRON_SECRET`      | Shared secret for `/api/cron`. No secret, no nightly run.                                   |
| `SOFRA_FROM_EMAIL` | Envelope sender for invites.                                                                |
| `RESEND_API_KEY`   | Only once you swap `ConsoleTransport` for `ResendTransport`.                                |

## Project layout

```
src/core/       the matching engine, pure: no I/O, no framework
src/providers/  the only place that knows a desk-booking system exists
src/notify/     invite content, ICS generation, and the delivery channels
src/store/      persistence behind one interface; an in-memory demo implementation
src/lib/        sign-in, session, config, dates, and the nightly job
src/sim/        synthetic company and the simulator
app/            Next.js app router: sign-in, opt-in page, matching console, RSVP page
teams/          Teams app manifest, icons, and how to package them
```

## Quality

```bash
npm run typecheck   # tsc, strict, noUncheckedIndexedAccess
npm run lint        # eslint, zero warnings tolerated
npm run format      # prettier
npm test            # 151 tests
npm run build       # production build
```

CI runs all five on every push and pull request. The engine has no runtime
dependencies, so the tests are fast enough to keep running as you work:
`npm run test:watch`.

One thing to verify before production: `MsGraphAttendanceProvider`'s default
predicate. Outlook's work-location feature has shipped under more than one shape,
so check it against the Graph version you target, or pass your own `isInOffice`.

## Licence

MIT.
