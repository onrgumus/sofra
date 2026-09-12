# Privacy and fairness decisions

Sofra runs inside an employer, on employee data, and produces an automated
decision about who spends their lunch break with whom. That combination attracts
more scrutiny than the feature set suggests, so the constraints are written down
here rather than discovered during a security review.

This is not legal advice. It is the reasoning behind the defaults, so your DPO
and works council have something concrete to react to.

## There is no gender field

The intuitive design balances every table by gender — two women, two men. Sofra
does not store gender at all, for three reasons:

1. **Discrimination exposure.** Using gender as a criterion in an automated
   process that allocates a workplace benefit is the shape of a claim, regardless
   of intent.
2. **Works councils.** In Germany, the Netherlands, France and elsewhere, an
   employee representative body must approve tools that process employee data.
   A gender quota is the single most likely thing in this product to be refused.
3. **It is not necessary.** The diversity that makes the lunch worthwhile comes
   from department, team, seniority and tenure — attributes already in the org
   chart, with an obvious business justification, and no protected status.

An earlier draft made gender optional, consent-gated and soft. That is defensible,
but it still means holding the data, still means explaining it, and still means a
conversation with every works council. Not collecting it is simpler and strictly
safer, and the tables come out the same.

This is enforced by a test, not just by convention: `tests/scoring.test.ts`
asserts that the score breakdown contains no gender term.

Age is handled the same way: Sofra has no age field. Tenure — how long someone
has worked here — is a legitimate business attribute that correlates with the
thing we actually want (someone who remembers how the place used to work),
without being a protected characteristic.

## Being in the office is not consent to be matched

Attendance and intent are separate, deliberately. Most office days people are
there to work with their own team, and a tool that treats presence as
availability would be reading something into the desk booking that the person
never said.

So opting in is per day and explicit: a box you tick for one specific date,
which does nothing to any other day. Nobody is enrolled by their manager, there
is no standing setting to forget about, and untick is always available until
matching runs the evening before.

## Data minimisation

The matcher needs surprisingly little, and takes nothing beyond it:

| Field | Why it is needed | Source |
|---|---|---|
| Department, team | The whole point: avoid seating colleagues together | Org chart |
| Seniority, title | Seniority spread | Org chart |
| Tenure (months) | Tenure spread, and an icebreaker | Org chart |
| Office, date | Only match people in the same building on the same day | Attendance provider |
| Languages | Hard constraint; a table must be able to talk | Directory or self-declared |
| Interests | Icebreakers | Self-declared, optional |

No location beyond building, no desk number, no meeting-title content, no
calendar contents, and no free text from anyone's calendar. The Graph provider
reads calendar entries only to answer "office or not" and keeps nothing else.

**No dietary information either.** It is the field every tool like this collects
without thinking, and it is the most sensitive thing on the list: vegetarian,
halal and gluten-free reveal religion or health, which GDPR Art. 9 and KVKK Art.
6 both name explicitly. The invite goes to the whole table at once, so printing
it would publish one person's religion to three colleagues who never asked. The
mail tells the table to settle the venue by replying to each other, which is
where that conversation belongs. A test asserts the invite never mentions food
restrictions.

## Attendance data stays where it is

`AttendanceProvider` returns `{ employeeId, officeId, date }` and nothing more.
Sofra does not mirror the desk-booking system, does not store a booking history,
and does not need write access to anything. When the day is over, the only record
worth keeping is which four people ate together — which is exactly what the
repeat-avoidance cooldown needs, and it can be reduced to hashed pairs with a
timestamp if your DPO prefers.

## Retention

`PastMatch` records only need to outlive the cooldown window (60 days by
default). Anything older contributes nothing to matching, so delete it. The
novelty score already treats "never met" and "met long ago" almost identically.

## No measurement of who socialises

Attendance is not reported anywhere and there is no leaderboard. A tool that
measures who socialises is a different, much worse product — and the moment
people suspect it exists, they stop ticking the box.

## Transparency

People should be able to see why they were seated where they were. The score
breakdown is already computed per group (`ScoreBreakdown`); surfacing it in the
invite costs nothing and pre-empts the question that otherwise reaches your DPO
as a complaint.
