import { getStore } from '../../src/store/instance';
import { SLOT } from '../../src/store/demo';
import { formatDay, todayInZone, upcomingWeekdays } from '../../src/lib/dates';
import { toVenue } from '../../src/lib/venue';
import { confirmUrl } from '../../src/lib/config';
import { MatchHistory } from '../../src/core/history';
import { scoreGroup } from '../../src/core/scoring';
import { DEFAULT_CONFIG } from '../../src/core/types';
import { buildInvite } from '../../src/notify/invite';
import type { Office, StoredGroup } from '../../src/store/types';
import { clearMatching, runMatching, sendInvites } from '../actions';
import { AutoSubmitSelect } from '../AutoSubmit';
import { Metric, PersonRow, Pill, ScoreBars, relaxationLabel, relaxationTone } from '../ui';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; officeId?: string }>;
}) {
  const store = getStore();
  const params = await searchParams;

  const offices = await store.listOffices();
  const officeId = offices.some((o) => o.id === params.officeId)
    ? params.officeId!
    : offices[0]!.id;
  const office = (await store.getOffice(officeId))!;

  // Offices in different zones are on different dates for part of every day.
  const dates = upcomingWeekdays(10, todayInZone(office.timeZone));
  const date = params.date && dates.includes(params.date) ? params.date : dates[0]!;

  const attending = await store.getAttendance(date, officeId);
  const attendingSet = new Set(attending);
  const optIns = (await store.listOptIns(date, officeId)).filter((o) =>
    attendingSet.has(o.employeeId),
  );
  const groups = await store.listGroups(date, officeId);
  const unmatched = await store.listUnmatched(date, officeId);

  // Same exclusion as the matcher used, so the novelty bars and the "first
  // meeting" count describe this plan rather than being cancelled out by it.
  const priorMatches = (await store.listPastMatches()).filter((m) => m.date !== date);
  const context = {
    history: new MatchHistory(priorMatches, date),
    config: DEFAULT_CONFIG,
  };

  const stats = summarise(groups, context.history);
  const invitesSent = groups.some((g) => g.invitesSentAt !== null);

  return (
    <main>
      <div className="page-head">
        <h1>Matching console</h1>
        <p>
          What the nightly job will do, with the button pressed by hand. Everything below is
          computed by the same engine the cron entry point will call.
        </p>
      </div>

      <section>
        <form method="get" action="/admin" className="inline">
          <AutoSubmitSelect
            name="date"
            defaultValue={date}
            aria-label="Date"
            options={dates.map((d) => ({ value: d, label: formatDay(d) }))}
          />
          <AutoSubmitSelect
            name="officeId"
            defaultValue={officeId}
            aria-label="Office"
            options={offices.map((o) => ({ value: o.id, label: o.displayName }))}
          />
        </form>
      </section>

      <section>
        <div className="metrics">
          <Metric value={attending.length} label="in the office" />
          <Metric value={optIns.length} label="asked for a lunch" />
          <Metric value={groups.length} label="tables" />
          <Metric value={stats.seated} label="people seated" />
          <Metric value={unmatched.length} label="unseated" />
        </div>
      </section>

      <section>
        <div className="row">
          <form action={runMatching}>
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="officeId" value={officeId} />
            <button type="submit" data-variant="primary" disabled={optIns.length === 0}>
              {groups.length > 0 ? 'Re-run matching' : 'Run matching'}
            </button>
          </form>

          <form action={sendInvites}>
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="officeId" value={officeId} />
            <button type="submit" disabled={groups.length === 0}>
              {invitesSent ? 'Re-send invites' : 'Send invites'}
            </button>
          </form>

          {groups.length > 0 ? (
            <form action={clearMatching}>
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="officeId" value={officeId} />
              <button type="submit" data-variant="quiet">
                Clear
              </button>
            </form>
          ) : null}

          {invitesSent ? <Pill tone="good">invites sent</Pill> : null}
        </div>

        {optIns.length === 0 ? (
          <p className="faint" style={{ marginTop: 10 }}>
            Nobody has asked for a lunch on this day yet. Opt in from the employee page first.
          </p>
        ) : null}
      </section>

      {groups.length > 0 ? (
        <section>
          <div className="section-head">
            <h2>Quality of this plan</h2>
            <p>What the diversity score actually bought.</p>
          </div>
          <div className="metrics">
            <Metric
              value={`${Math.round(stats.crossDepartment * 100)}%`}
              label="cross-department pairs"
            />
            <Metric value={stats.seniorityLevels.toFixed(2)} label="seniority levels per table" />
            <Metric value={stats.strangerPairs} label="pairs meeting for the first time" />
            <Metric value={stats.relaxed} label="tables needing a rule bent" />
          </div>
        </section>
      ) : null}

      <section>
        <div className="section-head">
          <h2>Tables</h2>
          {groups.length > 0 ? (
            <p>
              {SLOT} at {office.displayName}
            </p>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <div className="empty">
            No tables yet for {formatDay(date)}. Run matching to build them.
          </div>
        ) : (
          <div className="stack">
            {groups.map((group, index) => (
              <TableCard
                key={group.id}
                group={group}
                index={index}
                context={context}
                office={office}
              />
            ))}
          </div>
        )}

        {unmatched.length > 0 ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <Pill tone="bad">unseated</Pill>
              <span className="muted">
                These people opted in but could not be placed. They get an honest &ldquo;not
                today&rdquo; message, never silence.
              </span>
            </div>
            <div className="people">
              {unmatched.map((entry) => (
                <PersonRow key={entry.employee.id} person={entry.employee} detail="full" />
              ))}
            </div>
            <p className="faint" style={{ marginTop: 8 }}>
              Reason:{' '}
              {unmatched[0]!.reason === 'pool-too-small'
                ? 'fewer than three people opted in'
                : 'no language shared with anyone else in the pool'}
              .
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function TableCard({
  group,
  index,
  context,
  office,
}: {
  group: StoredGroup;
  index: number;
  context: Parameters<typeof scoreGroup>[1];
  office: Office;
}) {
  const breakdown = scoreGroup(group.members, context);
  const departments = new Set(group.members.map((m) => m.department));
  const invite = buildInvite({
    group,
    venue: toVenue(office),
    organizer: { name: 'Sofra', email: 'sofra@example.com' },
    confirmUrl: confirmUrl(group.id),
    sequence: group.sequence,
  });

  return (
    <article className="card">
      <div className="spread">
        <div className="row">
          <h3>Table {index + 1}</h3>
          <Pill tone="neutral">{group.members.length} people</Pill>
          <Pill tone="neutral">{departments.size} departments</Pill>
          <Pill tone={relaxationTone(group.relaxation)}>{relaxationLabel(group.relaxation)}</Pill>
          {group.cancelled ? <Pill tone="bad">cancelled</Pill> : null}
        </div>
        <span className="faint mono">score {breakdown.total.toFixed(2)}</span>
      </div>

      <div className="people">
        {group.members.map((person) => (
          <PersonRow key={person.id} person={person} rsvp={group.rsvps[person.id]} detail="full" />
        ))}
      </div>

      <ScoreBars breakdown={breakdown} />

      <p className="faint" style={{ marginTop: 12 }}>
        Topic for this table: {invite.topic}
      </p>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="faint">speaks {group.commonLanguages.join(', ')}</span>
        {group.cancelled && group.cancellationSentAt ? (
          <Pill tone="neutral">cancellation sent</Pill>
        ) : group.cancelled && group.invitesSentAt ? (
          <Pill tone="warn">cancellation pending</Pill>
        ) : group.invitesSentAt ? (
          <Pill tone="good">invite sent</Pill>
        ) : group.sequence > 0 ? (
          <Pill tone="warn">reseated — needs a fresh invite</Pill>
        ) : null}
      </div>

      <details>
        <summary>Preview the invite</summary>
        <div className="invite">{invite.text}</div>
        <details>
          <summary>Calendar attachment (.ics)</summary>
          <div className="invite">{invite.ics}</div>
        </details>
      </details>
    </article>
  );
}

function summarise(groups: readonly StoredGroup[], history: MatchHistory) {
  let crossDepartment = 0;
  let pairs = 0;
  let seniorityLevels = 0;
  let strangerPairs = 0;

  for (const group of groups) {
    seniorityLevels += new Set(group.members.map((m) => m.seniority)).size;
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        const a = group.members[i]!;
        const b = group.members[j]!;
        pairs++;
        if (a.department !== b.department) crossDepartment++;
        // The history was built before this plan was saved, so a null here means
        // these two have genuinely never had lunch together.
        if (history.daysSince(a.id, b.id) === null) strangerPairs++;
      }
    }
  }

  return {
    seated: groups.reduce((sum, g) => sum + g.members.length, 0),
    crossDepartment: pairs === 0 ? 0 : crossDepartment / pairs,
    seniorityLevels: groups.length === 0 ? 0 : seniorityLevels / groups.length,
    strangerPairs,
    relaxed: groups.filter((g) => g.relaxation !== 'none').length,
  };
}
