import type { Employee } from '../src/core/types';
import type { ScoreBreakdown } from '../src/core/scoring';
import type { RsvpStatus } from '../src/store/types';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className="pill" data-tone={tone}>
      {children}
    </span>
  );
}

export function Initials({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('');
  return <span className="avatar">{initials}</span>;
}

export function PersonRow({
  person,
  rsvp,
  highlight,
}: {
  person: Employee;
  rsvp?: RsvpStatus;
  highlight?: boolean;
}) {
  return (
    <div className="person">
      <Initials name={person.displayName} />
      <div>
        <div className="person-name">
          {person.displayName}
          {highlight ? <span className="muted"> · you</span> : null}
        </div>
        <div className="person-meta">
          {person.title} · {person.department} ({teamName(person.team)}) · {person.tenureMonths}{' '}
          months here
        </div>
      </div>
      {rsvp ? <RsvpPill status={rsvp} /> : null}
    </div>
  );
}

export function RsvpPill({ status }: { status: RsvpStatus }) {
  if (status === 'accepted') return <Pill tone="good">coming</Pill>;
  if (status === 'declined') return <Pill tone="bad">can&apos;t make it</Pill>;
  return <Pill tone="neutral">no reply yet</Pill>;
}

const BAR_LABELS: Record<keyof Omit<ScoreBreakdown, 'total'>, string> = {
  department: 'department',
  seniority: 'seniority',
  tenure: 'tenure',
  interests: 'interests',
  novelty: 'novelty',
};

export function ScoreBars({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <div className="bars">
      {(Object.keys(BAR_LABELS) as (keyof typeof BAR_LABELS)[]).map((part) => (
        <div className="bar" key={part}>
          <span className="bar-label">{BAR_LABELS[part]}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.round(breakdown[part] * 100)}%` }} />
          </span>
          <span className="bar-value">{breakdown[part].toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

export function teamName(team: string): string {
  const slash = team.lastIndexOf('/');
  return slash === -1 ? team : team.slice(slash + 1);
}

export function relaxationTone(relaxation: string): Tone {
  if (relaxation === 'none') return 'good';
  return relaxation === 'allow-repeat' ? 'warn' : 'bad';
}

export function relaxationLabel(relaxation: string): string {
  if (relaxation === 'none') return 'all rules honoured';
  return relaxation === 'allow-repeat' ? 'repeat pairing allowed' : 'teammates seated together';
}
