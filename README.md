# Sofra

[![CI](https://github.com/onrgumus/sofra/actions/workflows/ci.yml/badge.svg)](https://github.com/onrgumus/sofra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

You can spend years in a building with people whose work you never see. As more
of the routine gets automated, what is left is the part that runs on knowing who
to ask — and that is not on any org chart. Sofra spends an hour you were going
to spend anyway on three people most likely to teach you something.

Hybrid work made it worse: you go in three days a week, sit with your own team,
and leave. Sofra puts three or four people who would never otherwise meet at the
same lunch table on a day they are all already in the building.

Being in the office is not the signal. Most office days you are there to work
with your own team, and that is fine — Sofra does nothing unless you tick a box
for that specific day saying you would rather meet people from other teams.

It works at any company, because it never integrates with your desk-booking
tool.

## The idea that makes it portable

Every company uses a different desk-booking app — Envoy, Robin, deskbird,
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
| `CompositeAttendanceProvider` | —                | Real rollouts are mixed. Union the sources; one being down does not cancel lunch.                                   |

Start with `Manual`, add a real feed once the habit exists.

## Why not just use a Teams channel

You can, and for a small office you should. A `#lunch` channel where people post
"I'm in today" costs nothing and works fine at twenty people.

It breaks at two hundred, for two reasons. Somebody has to group everyone by
hand, every day. And self-organising reproduces the cliques it was meant to
break: people reply to the people they already know, which is the exact failure
this is supposed to fix.

There are also existing products in this category — Donut for Slack,
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
culture where nobody will tick the box — no app fixes that last one.

## What the matcher optimises for

Seating four strangers together is a max-weight set packing problem, which is
NP-hard. Sofra uses greedy construction seeded from the hardest-to-place person,
then 2-opt local search. On pools under ~500 it runs in milliseconds and lands
close enough to optimal that the difference is not something a human at a lunch
table could perceive.

Hard rules — same building and day, no two people from the same immediate
team, nobody re-matched inside the cooldown window, and every table must share a
language.

Soft score — spread of departments, spread across the seniority ladder,
tenure gap, at least one shared interest as an opener, and novelty.

Nobody eats alone. If the pool is too homogeneous to honour every rule, the
matcher walks a relaxation ladder (`none` → `allow-repeat` → `allow-same-team`)
and takes a penalty rather than turning someone away. Everyone who ticked the box
is split evenly into tables of three or four, so a pool of 9 becomes `[3, 3, 3]`
and a pool of 11 becomes `[4, 4, 3]` — never two tables and one person left
standing in the lobby. "No match was found for you" is the one email that would
kill this product, so the engine is built so it cannot be sent.

And nobody is stranded by other people's plans. The invite says "let us know
by 10:00 so we can reseat the table", so it reseats. When declines drop a table
below three, whoever still wants lunch is moved to another table that day with
room and no rule broken; only if there is genuinely nowhere to put someone do
they hear the lunch is off. A receiving table may go to five for that one
sitting — a slightly crowded table beats sending somebody away — and its calendar
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
average table score declines week over week — that is the novelty budget being
spent, and it is the signal that tells you when to widen the pool.

It then prints a real invite, generated from the actual match:

```
subject: Lunch today at 12:00 — the four of you

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
• Your hobbies — what you spend time on when you are not here
• What would make you happier about coming into the office
• One thing you genuinely think we could be doing better

Today's topic
The part of your job that would surprise someone outside your department.

If the conversation stalls
• You all put "photography" on your profile. Start there.
• Sales, Product, Engineering, Design are at this table. What does each of you
  think the others actually do all day?

And do not let it turn into a work meeting
Leave room for the rest of it — sport, music and films, the city, where you grew
up, what you actually care about. You can get a status update over Slack. The
point of this table is the people sitting at it.
```

Flags: `--size`, `--weeks`, `--participation`, `--seed`, `--office`.

## Invites

One mail to the whole table, not four separate notes. Everyone sees the same
names at the same moment, can reply to each other beforehand, and nobody has to
wonder whether the others got it.

It carries an introduction round — how long you have been here, what you
actually do, the project you are on, what you did before this job, your hobbies,
what would make the office better, and one thing we could genuinely be doing
better. Then a topic for the table, picked stably per group so re-sending
does not change what people turned up prepared for, and varied across tables so
four departments are not all having the same conversation.

It closes by telling the table not to spend the hour on work. Left alone,
four colleagues will produce a status meeting with food; the mail explicitly asks
for sport, music, the city, where people grew up, what they care about.

### Slack and Teams

Where a company has them, the invite is better as a conversation than as a mail.
Both channels open a group chat with exactly the four people and post the
invite into it, so "shall we try the new place instead" happens where the plan
was made, and the cancellation lands in the same chat.

| Channel            | What it does                                                                    | What it costs                                                                |
| ------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `EmailChannel`     | One mail to the table, `.ics` attached                                          | nothing — always on                                                          |
| `SlackChannel`     | `conversations.open` with the four, then a Block Kit post with a confirm button | a bot token: `mpim:write`, `chat:write`, `users:read.email`                  |
| `TeamsChannel`     | `POST /chats` with the four, then an Adaptive Card                              | a Graph app with `Chat.Create` and `ChatMessage.Send` — tenant admin consent |
| `CompositeChannel` | All of the above; one being down does not stop the others                       | —                                                                            |

Both are idempotent about the conversation: re-sending an updated invite posts
into the chat that already exists rather than starting a second one.

Being honest about the trade: the Teams channel is the one part of Sofra that
needs IT to say yes. Email and the `.ics` need nothing, which is why they are
the default and why the product still works at a company that never approves
anything.

## Inside Teams

Sofra also runs as a Teams personal tab — its own pages, rendered in Teams,
with the person already signed in. `teams/README.md` has the app registration
and packaging; `npm run teams:package` produces the uploadable zip.

Signing in is the part worth being careful about. The tempting shortcut is
`app.getContext()`, which hands you the user's email in one line — client-side,
where anyone can put whatever they like in a `fetch`. Sofra instead takes the
signed token from `authentication.getAuthToken()` and verifies it on the server
against Microsoft's published keys: signature, algorithm, audience, issuer,
tenant and expiry. The tests in `tests/teams-auth.test.ts` mint tokens with a
real key pair and check that a forged signature, `alg: none`, another
application's audience, another tenant, an expired token and an unknown signing
key are each refused.

Two details that are easy to miss and break everything quietly:

- A tab is a cross-site iframe, so a `SameSite=Lax` session cookie is never
  sent and the session appears to vanish on every request. `SOFRA_ALLOW_EMBEDDING`
  switches it to `SameSite=None; Secure`.
- The app has to allow being framed. `frame-ancestors` names the Teams hosts
  explicitly rather than leaving it open.

The tab needs no bot, no `Chat.Create`, and no application permissions — unlike
the Teams _group chat_ above, which does. They are independent: you can have the
tab without the chat, or neither, and Sofra still works.

### The calendar invite

An RFC 5545 `.ics` with `METHOD:REQUEST` rather than a call to the Teams or
Google Calendar API. An `.ics` is accepted by Outlook,
Teams, Google Calendar and Apple Calendar alike, and needs no tenant admin
consent, no per-company app registration and no calendar write scope — which is
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
explicitly special categories under GDPR Art. 9 and KVKK Art. 6 — and this mail
goes to three colleagues at once, so printing "halal" next to somebody's name
publishes it to people who never needed to know. The table sorts the venue out by
replying to each other instead.

None of it turns out to be a loss. The diversity that makes the lunch worth
having comes from department, team, seniority and tenure — all already in the org
chart, all with an obvious business justification, none of them a protected
characteristic. Tests assert that the score has no gender term and that the
invite never mentions what anyone eats. See [docs/privacy.md](docs/privacy.md).

## What is here, and what is not

Built and tested: the matching engine, the provider abstraction with five
implementations, ICS generation, bilingual invite content with topics, the email
transport layer, the simulator, the nightly job, and a Next.js app — per-day
opt-in, a matching console that shows the score behind every table, and the
confirm-by-10:00 flow that reseats people when a table collapses, and a Teams tab. 151 tests.

Run it with `npm run dev` and sign in as onur / 1234, or take a random
colleague from the same screen — a shared link means several people clicking at
once, and they should not all be ticking the same boxes. The app is seeded with
a synthetic company through an in-memory store, so it needs no database and no
API keys.

Dates are resolved in each office's own timezone rather than the server's, since
Istanbul and Amsterdam are on different dates for part of every day.

Not built yet: real authentication and persistence.

Sign-in is one shared password so anyone with the link can try the product — a
demo gate, not authentication, though the session cookie is HMAC-signed so an
employee id cannot be forged in devtools. Replacing `src/lib/auth.ts` and
`src/lib/session.ts` is the whole of adding real sign-in.

Persistence is a swap of `src/store/instance.ts` for an implementation of the
same interface. That claim used to be false: every method on `Store` returned a
plain value, which no database can do, so the only implementation that could
ever have existed was the in-memory one. The interface is fully async now — 249
type errors' worth of change, which is exactly the bill that would otherwise
have arrived on the first real deployment.

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
openly — anyone who could reach it would be able to reshuffle tomorrow's tables
and mail the whole company. The admin console's button calls exactly the same
`planDay`, so what you see there is what the cron produces.

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
src/core/       the matching engine — pure, no I/O, no framework
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
so check it against the Graph version you target — or pass your own `isInOffice`.

## Licence

MIT.
