# Privacy and fairness decisions

Sofra runs inside an employer, on employee data, and produces an automated
decision about who spends their lunch break with whom. That combination attracts
more scrutiny than the feature set suggests, so the constraints are written down
here rather than discovered during a security review.

This is not legal advice. It is the reasoning behind the defaults, so your DPO
and works council have something concrete to react to.

## Gender is opt-in, soft, and inert by default

The intuitive design balances every table by gender — two women, two men. Sofra
does not implement that, for three reasons:

1. **Discrimination exposure.** Using gender as a criterion in an automated
   process that allocates a workplace benefit is the shape of a claim, regardless
   of intent. A quota makes gender determinative for some people's outcome.
2. **Works councils.** In Germany, the Netherlands, France and elsewhere, an
   employee representative body must approve tools that process employee data.
   A gender quota is the single most likely thing in this product to be refused.
3. **It is not necessary.** The diversity that makes the lunch worthwhile comes
   from department, team, seniority and tenure — attributes already in the org
   chart, with an obvious business justification, and no protected status.

What ships instead:

- Declaring gender is **optional**, with `undisclosed` a first-class value.
- Gender influences matching **only** for people who set
  `prefersBalancedGroup: true` on that specific opt-in.
- Fewer than two consenting members at a table makes the term **inert** — so
  opting out never costs you a seat or a worse table.
- Even with consent it is a **soft score**, weighted below department and
  seniority. It never decides on its own.

This is enforced by tests, not just by convention. See the `gender balance`
block in `tests/scoring.test.ts`, in particular the case asserting that with no
consent, a perfectly balanced table and a completely skewed one score
*identically*.

Age is handled the same way, and more conservatively: Sofra has no age field at
all. Tenure — how long someone has worked here — is a legitimate business
attribute that correlates with the thing we actually want (someone who remembers
how the place used to work), without being a protected characteristic.

## Data minimisation

The matcher needs surprisingly little, and takes nothing beyond it:

| Field | Why it is needed | Source |
|---|---|---|
| Department, team | The whole point: avoid seating colleagues together | Org chart |
| Seniority, title | Seniority spread | Org chart |
| Tenure (months) | Tenure spread, and an icebreaker | Org chart |
| Office, date | Only match people in the same building on the same day | Attendance provider |
| Languages | Hard constraint; a table must be able to talk | Directory or self-declared |
| Interests, dietary | Icebreakers and venue choice | Self-declared, optional |
| Gender | Soft balance, consent-gated | Self-declared, optional |

No location beyond building, no desk number, no meeting-title content, no
calendar contents, and no free text from anyone's calendar. The Graph provider
reads calendar entries only to answer "office or not" and keeps nothing else.

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

## Participation is voluntary, per slot

Opting in is per lunch, not a standing setting. Nobody is enrolled by their
manager, attendance is not reported anywhere, and there is no leaderboard. A tool
that measures who socialises is a different, much worse product — and the moment
people suspect it exists, they stop opting in.

## Transparency

People should be able to see why they were seated where they were. The score
breakdown is already computed per group (`ScoreBreakdown`); surfacing it in the
invite costs nothing and pre-empts the question that otherwise reaches your DPO
as a complaint.
