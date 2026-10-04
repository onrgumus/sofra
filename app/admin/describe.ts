import { formatDay } from '../../src/lib/dates';

/**
 * Runs and audit entries in words an admin reads at a glance. The record as
 * stored stays one hover away, in the cell's title.
 */

type Fields = Record<string, unknown>;

const ACTIONS: Record<string, string> = {
  'admin.grant': 'Made an admin',
  'admin.revoke': 'No longer an admin',
  'company.rename': 'Renamed the company',
  'department.add': 'Added a department',
  'department.remove': 'Removed a department',
  'department.rename': 'Renamed a department',
  'directory.sync': 'Synced the directory',
  'domain.add': 'Allowed a domain',
  'domain.remove': 'Removed a domain',
  'holiday.add': 'Added a holiday',
  'holiday.remove': 'Removed a holiday',
  'match.run': 'Made the tables by hand',
  'office.create': 'Created an office',
  'office.update': 'Changed an office',
  'person.deactivate': 'Deactivated',
  'person.office': 'Moved to another office',
  'person.reactivate': 'Reactivated',
  'person.signout': 'Signed out everywhere',
  'reminder.run': 'Sent the reminder by hand',
};

const JOBS: Record<string, string> = {
  match: 'Tables',
  reminder: 'Evening question',
  'directory-sync': 'Directory sync',
};

const OFFICE_FIELDS: Record<string, string> = {
  name: 'name',
  address: 'address',
  meetingPoint: 'meeting point',
  timeZone: 'time zone',
  opensAt: 'opening time',
  matchLeadMinutes: 'when tables are made',
  confirmBy: 'reply cut-off',
  reminderAt: 'evening question',
  lunchSlots: 'lunch times',
  workingDays: 'working days',
  minTable: 'smallest table',
  maxTable: 'largest table',
  locationKeywords: 'Outlook keywords',
  active: 'open or closed',
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export function jobLabel(kind: string): string {
  return JOBS[kind] ?? kind;
}

/** "2026-10-05" as "Mon 5 Oct"; anything else as it is. */
export function dayLabel(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDay(value) : value;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a scheduled or manual job did, in a line. */
export function runSummary(kind: string, summary: Fields): string {
  if (typeof summary.reason === 'string') return `Not run: ${summary.reason}.`;

  if (kind === 'match') {
    return [
      `${num(summary.requests)} asked`,
      plural(num(summary.tables), 'table'),
      `${num(summary.seated)} seated`,
      num(summary.unseated) > 0 ? `${num(summary.unseated)} could not be seated` : '',
      plural(num(summary.invitesSent), 'invite') + ' sent',
      num(summary.previousCancelled) > 0
        ? `${plural(num(summary.previousCancelled), 'earlier invite')} cancelled`
        : '',
      num(summary.failedToDeliver) > 0 ? `${num(summary.failedToDeliver)} not delivered` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  if (kind === 'reminder') {
    return [
      `${plural(num(summary.asked), 'person', 'people')} asked`,
      num(summary.alreadyIn) > 0 ? `${num(summary.alreadyIn)} already in` : '',
      num(summary.notLikely) > 0 ? `${num(summary.notLikely)} not likely in` : '',
      num(summary.optedOut) > 0 ? `${num(summary.optedOut)} turned it off` : '',
      num(summary.failed) > 0 ? `${num(summary.failed)} not delivered` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  if (kind === 'directory-sync') {
    return [
      `${num(summary.read)} read`,
      `${num(summary.created)} added`,
      `${num(summary.updated)} updated`,
      `${num(summary.deactivated)} deactivated`,
      typeof summary.heldBack === 'string' ? `held back: ${summary.heldBack}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return Object.entries(summary)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');
}

/** The details of an audit entry, in a line. */
export function auditSummary(
  action: string,
  details: Fields,
  officeName: (id: string) => string,
): string {
  const office = (v: unknown) =>
    v === 'every office' ? 'every office' : typeof v === 'string' ? officeName(v) : 'no office';

  switch (action) {
    case 'admin.grant':
    case 'admin.revoke':
      return `Admin of ${office(details.officeId)}`;
    case 'holiday.add':
      return `${dayLabel(String(details.date))}: ${String(details.name ?? '')}`;
    case 'holiday.remove':
      return dayLabel(String(details.date));
    case 'match.run':
      return `For ${dayLabel(String(details.date))}: ${runSummary('match', (details.summary ?? {}) as Fields)}`;
    case 'reminder.run':
      return `For ${dayLabel(String(details.date))}: ${runSummary('reminder', (details.summary ?? {}) as Fields)}`;
    case 'department.rename':
      return `To ${String(details.to)}`;
    case 'person.office':
      return `${office(details.from)} → ${office(details.to)}`;
    case 'person.signout':
      return plural(num(details.sessions), 'session') + ' ended';
    case 'directory.sync':
      return runSummary('directory-sync', details);
    case 'office.create': {
      const o = (details.office ?? {}) as Fields;
      return `${String(o.timeZone)}, opens ${String(o.opensAt)}, lunch ${(o.lunchSlots as string[] | undefined)?.join(', ') ?? ''}`;
    }
    case 'office.update': {
      const before = (details.before ?? {}) as Fields;
      const after = (details.after ?? {}) as Fields;
      const changed = Object.keys(OFFICE_FIELDS).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
      );
      return changed.length > 0
        ? `Changed ${changed.map((k) => OFFICE_FIELDS[k]).join(', ')}`
        : 'Saved without changes';
    }
    default:
      return '';
  }
}
