# Sofra

Hybrid work solved the commute and quietly broke the thing offices were for. You
go in three days a week, sit with your own team, and leave. Sofra puts three or
four people who would never otherwise meet at the same lunch table on a day they
are all already in the building.

Being in the office is not the signal. Most office days you are there to work
with your own team, and that is fine — Sofra does nothing unless you tick a box
for that specific day saying you would rather meet people from other teams.

It works at **any** company, because it never integrates with your desk-booking
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

| Provider | Integration cost | Where it fits |
|---|---|---|
| `ManualAttendanceProvider` | none | Every company, day one. People just tell the app. |
| `MsGraphAttendanceProvider` | low | Most desk tools write the booking back to Outlook, so reading Outlook covers them all without touching any of them. |
| `CsvAttendanceProvider` | low | IT can always produce a CSV, even when procurement will not approve an API. |
| `WebhookAttendanceProvider` | low | For desk tools that can push. |
| `CompositeAttendanceProvider` | — | Real rollouts are mixed. Union the sources; one being down does not cancel lunch. |

Start with `Manual`, add a real feed once the habit exists.

## What the matcher optimises for

Seating four strangers together is a max-weight set packing problem, which is
NP-hard. Sofra uses greedy construction seeded from the hardest-to-place person,
then 2-opt local search. On pools under ~500 it runs in milliseconds and lands
close enough to optimal that the difference is not something a human at a lunch
table could perceive.

**Hard rules** — same building and day, no two people from the same immediate
team, nobody re-matched inside the cooldown window, and every table must share a
language.

**Soft score** — spread of departments, spread across the seniority ladder,
tenure gap, at least one shared interest as an opener, and novelty.

**Nobody eats alone.** If the pool is too homogeneous to honour every rule, the
matcher walks a relaxation ladder (`none` → `allow-repeat` → `allow-same-team`)
and takes a penalty rather than turning someone away. Everyone who ticked the box
is split evenly into tables of three or four, so a pool of 9 becomes `[3, 3, 3]`
and a pool of 11 becomes `[4, 4, 3]` — never two tables and one person left
standing in the lobby. "No match was found for you" is the one email that would
kill this product, so the engine is built so it cannot be sent.

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
• Ada Yılmaz — Specialist, Engineering (Platform)
• Bruno Costa — Associate, Sales (SMB)
• Chloe Kaya — Lead, Design (Research)
• Deniz Novak — Manager, Finance (FP&A)

How to start
Go round the table before you order. Name, which team you are on, what you
actually work on day to day, and what you were doing before you got here. That
last one is usually where the interesting part is.

Today's topic
What other teams consistently misunderstand about yours.

If the conversation stalls
• Engineering, Sales, Design, Finance are at this table. What does each of you
  think the others actually do all day?
...
```

Flags: `--size`, `--weeks`, `--participation`, `--seed`, `--office`.

## Invites

**One mail to the whole table**, not four separate notes. Everyone sees the same
names at the same moment, can reply to each other beforehand, and nobody has to
wonder whether the others got it.

It carries an **introduction round** — name, team, what you actually do, and what
you were doing before this job — and a **topic** for the table, picked stably per
group so re-sending does not change what people turned up prepared for, and
varied across tables so four departments are not all having the same
conversation.

The calendar invite is an RFC 5545 `.ics` with `METHOD:REQUEST` rather than a
call to the Teams or Google Calendar API. An `.ics` is accepted by Outlook,
Teams, Google Calendar and Apple Calendar alike, and needs no tenant admin
consent, no per-company app registration and no calendar write scope — which is
the whole point of a tool that has to work everywhere.

Icebreakers are derived from the table itself: a shared interest first, then the
widest gap in the room. The invite is written in a language everyone at the table
speaks (`en` and `tr` ship; the matcher guarantees at least one is shared).

## There is no gender field

The obvious version of this product balances each table by gender. Sofra has no
gender data at all — not optional, not consent-gated, not weighted. In an
employment context, automated grouping by gender or age invites both GDPR/KVKK
scrutiny and discrimination claims, and European works councils will block it
outright.

It turns out not to be a loss. The diversity that makes the lunch worth having
comes from department, team, seniority and tenure — all already in the org chart,
all with an obvious business justification, none of them a protected
characteristic. A test asserts the score has no gender term. See
[docs/privacy.md](docs/privacy.md).

## What is here, and what is not

Built and tested: the matching engine, the provider abstraction with five
implementations, ICS generation, bilingual invite content with topics, the email
transport layer, the simulator, and a Next.js app — per-day opt-in, a matching
console that shows the score behind every table, and the confirm-by-10:00 flow
that cancels a table when too many people drop out. 73 tests.

Run it with `npm run dev`. The app is seeded with a synthetic company through an
in-memory store, so it needs no database and no API keys; swap
`src/store/instance.ts` for a Postgres implementation of the same interface and
nothing else changes.

Not built yet: authentication, persistence, and the cron entry point that calls
`runMatching` the evening before.

One thing to verify before production: `MsGraphAttendanceProvider`'s default
predicate. Outlook's work-location feature has shipped under more than one shape,
so check it against the Graph version you target — or pass your own `isInOffice`.

## Licence

MIT.
