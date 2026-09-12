# Sofra

Hybrid work solved the commute and quietly broke the thing offices were for. You
go in three days a week, sit with your own team, and leave. Sofra puts four
people who would never otherwise meet at the same lunch table on a day they are
all already in the building.

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
and takes a penalty rather than turning someone away. Group sizes flex between 3
and 5 so a pool of 9 becomes `[5, 4]` instead of two tables and one person left
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
seated               295/295 opt-ins (100.0%)
table sizes          3p x1  4p x63  5p x8
cross-department     85.9% of pairs
seniority levels     3.18 distinct per table
repeat pairings      0/461 pairs met more than once
rules bent           none x72
```

Every opt-in got a seat, 86% of the people sitting together came from different
departments, and across eight weeks no pair was ever seated together twice. The
average table score declines week over week — that is the novelty budget being
spent, and it is the signal that tells you when to widen the pool.

It then prints a real invite, generated from the actual match:

```
subject: Lunch with three people you have not met

You are one of 4 people having lunch together at 12:00 today.

Where
Istanbul HQ — Ground floor cafeteria, by the coffee bar

Who
• Felix Eriksson — Senior Specialist, Engineering (Platform)
• Mira Rossi — Associate, Product (Growth)
• Zeynep Lopez — Specialist, Sales (SMB)
• Zeynep Kaya — Specialist, Finance (Accounting)

If the conversation stalls
• Engineering, Product, Sales, Finance are at this table. What does each of you
  think the others actually do all day?
...
```

Flags: `--size`, `--weeks`, `--participation`, `--seed`, `--office`.

## Invites

Sofra sends an RFC 5545 `.ics` with `METHOD:REQUEST` rather than calling the
Teams or Google Calendar API. An `.ics` is accepted by Outlook, Teams, Google
Calendar and Apple Calendar alike, and needs no tenant admin consent, no
per-company app registration and no calendar write scope — which is the whole
point of a tool that has to work everywhere.

Icebreakers are derived from the table itself: a shared interest first, then the
widest gap in the room. The invite is written in a language everyone at the table
speaks (`en` and `tr` ship; the matcher guarantees at least one is shared).

## Gender and age are opt-in, and soft

The obvious version of this product balances each table by gender. Sofra
deliberately does not, because in an employment context automated grouping by
gender or age invites both GDPR/KVKK scrutiny and discrimination claims, and
European works councils will block it outright.

What it does instead: declaring gender is optional, it only influences matching
for people who explicitly ask for balanced groups, and even then it is a soft
score rather than a quota. It produces materially the same tables and is
actually deployable. See [docs/privacy.md](docs/privacy.md).

## What is here, and what is not

Built and tested: the matching engine, the provider abstraction with five
implementations, ICS generation, bilingual invite content, the email transport
layer, and the simulator. 46 tests, no runtime dependencies.

Not built yet: the web app (opt-in UI, admin console), persistence, the cron
entry point, and the confirm-by-10:00 flow that reseats a table when someone
drops. The engine is a pure function over plain data, so all of that is wiring.

One thing to verify before production: `MsGraphAttendanceProvider`'s default
predicate. Outlook's work-location feature has shipped under more than one shape,
so check it against the Graph version you target — or pass your own `isInOffice`.

## Licence

MIT.
