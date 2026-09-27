# Privacy and fairness decisions

Sofra runs inside an employer, on employee data, and produces an automated
decision about who spends their lunch break with whom. That combination attracts
more scrutiny than the feature set suggests, so the constraints are written down
here rather than discovered during a security review.

This is not legal advice. It is the reasoning behind the defaults, so your DPO
and works council have something concrete to react to.

## There is no gender field

The intuitive design balances every table by gender: two women, two men. Sofra
does not store gender at all, for three reasons:

1. Discrimination exposure. Using gender as a criterion in an automated
   process that allocates a workplace benefit is the shape of a claim, regardless
   of intent.
2. Works councils. In Germany, the Netherlands, France and elsewhere, an
   employee representative body must approve tools that process employee data.
   A gender quota is the single most likely thing in this product to be refused.
3. It is not necessary. The diversity that makes the lunch worthwhile comes
   from department, team, seniority and tenure, attributes already in the org
   chart, with an obvious business justification, and no protected status.

An earlier draft made gender optional, consent-gated and soft. That is defensible,
but it still means holding the data, still means explaining it, and still means a
conversation with every works council. Not collecting it is simpler and strictly
safer, and the tables come out the same.

This is enforced by a test, not just by convention: `tests/scoring.test.ts`
asserts that the score breakdown contains no gender term.

Age is handled the same way: Sofra has no age field. Tenure, meaning how long someone
has worked here, is a legitimate business attribute that correlates with the
thing we actually want (someone who remembers how the place used to work),
without being a protected characteristic.

## Being in the office is not consent to be matched

Presence and intent are separate, deliberately. Most office days people are
there to work with their own team, and a tool that treats presence as
availability would be reading something into a calendar that the person never
said.

So asking is per day and explicit: one press for one specific date, which does
nothing to any other day, or a weekly pattern the person set up themselves and
can skip for any single week. Nobody is enrolled by their manager, and dropping
out is always possible until the reply cut-off.

Being asked is a different thing from being matched. The evening before, one
short question goes to people likely to want lunch: those who have eaten through
Sofra in the last four weeks, and, where the company has turned it on, those
whose Outlook says they will be in. It is one message per person per day, it
never leads anywhere by itself, and it can be turned off for good on the profile
page. What a calendar never does is put somebody at a table: no answer is the
same as no.

## Your table is yours

A table's page shows it only to the people seated at it. Table ids are random,
and still: belonging to the table is the only thing that makes its roster yours,
because the roster is exactly the list of who asked for lunch that day. Somebody
who follows an old link after being moved is pointed at their own table and told
nothing about the one they landed on.

The same rule holds for writes. Every action takes the person acting from the
session, never from a field in the form, so a reply, a request or a drop-out
applies to the person making it and nobody else. Tests check the actions' source
for exactly this.

The whole-office view belongs to the console, which is for admins, office by
office, and returns 404 to everybody else.

## Data minimisation

The matcher needs surprisingly little, and takes nothing beyond it:

| Field            | Why it is needed                                       | Source                     |
| ---------------- | ------------------------------------------------------ | -------------------------- |
| Department, team | The whole point: avoid seating colleagues together     | Org chart                  |
| Seniority, title | Seniority spread                                       | Org chart                  |
| Tenure (months)  | Tenure spread, and an icebreaker                       | Org chart                  |
| Office, date     | Only match people in the same building on the same day | The person, per day        |
| Languages        | Hard constraint; a table must be able to talk          | Directory or self-declared |
| Interests        | Icebreakers                                            | Self-declared, optional    |

No location beyond building, no desk number, no meeting-title content, no
calendar contents, and no free text from anyone's calendar. Where Outlook hints
are turned on, calendar entries are read only to answer "which office, or none"
for each day, and that answer is all that is kept.

No dietary information either. It is the field every tool like this collects
without thinking, and it is the most sensitive thing on the list: vegetarian,
halal and gluten-free reveal religion or health, which GDPR Art. 9 and KVKK Art.
6 both name explicitly. The invite goes to the whole table at once, so printing
it would publish one person's religion to three colleagues who never asked. The
mail tells the table to settle the venue by replying to each other, which is
where that conversation belongs. A test asserts the invite never mentions food
restrictions.

## What signing in leaves behind

No passwords exist to leak. For each session Sofra keeps a hash of its token,
when it was created and last used, and the browser's user agent and network
address, so a person can see where they are signed in and end it. For each
emailed link it keeps a hash, the address it was for and when it was used.
Rate limits keep a key and a time for fifteen minutes. Expired sessions and
links are deleted by the scheduler.

Admin actions are recorded in an audit log with who did what to what, which is
the record a works council or an auditor will ask for.

## Retention

Past tables only need to outlive the repeat cooldown (60 days by default);
matching reads the last 400 days at most. Anything older contributes nothing,
so it can be deleted on whatever schedule the company's retention policy sets.
Deactivated people are kept, so that the tables they sat at stay intact for
everybody else, and can be deleted outright when policy says so: their rows
cascade.

## No measurement of who socialises

Who asked for lunch is not reported anywhere and there is no leaderboard. A tool that
measures who socialises is a different, much worse product, and the moment
people suspect it exists, they stop ticking the box.

## Transparency

People should be able to see why they were seated where they were. The score
breakdown is already computed per group (`ScoreBreakdown`); surfacing it in the
invite costs nothing and pre-empts the question that otherwise reaches your DPO
as a complaint.
