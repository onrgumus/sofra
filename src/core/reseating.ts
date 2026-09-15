import { RELAXATION_LADDER, canJoin } from './constraints';
import { MatchHistory } from './history';
import type { Employee, MatchConfig, PastMatch } from './types';

/**
 * What a reply does to a day's tables.
 *
 * Extracted from the in-memory store so that a database-backed one does not
 * have to reimplement it. The function mutates the groups it is given and
 * returns the ones that changed, which is exactly the set a store needs to
 * write back.
 */
export type RsvpStatus = 'pending' | 'accepted' | 'declined';

/** The parts of a stored table this logic touches. Stores may carry more. */
export interface SeatedTable {
  id: string;
  date: string;
  officeId: string;
  members: Employee[];
  rsvps: Record<string, RsvpStatus>;
  cancelled: boolean;
  sequence: number;
  invitesSentAt: string | null;
  cancellationSentAt: string | null;
}

export interface ApplyRsvpOptions {
  /** Every table that day at that office, including the one being replied to. */
  tables: SeatedTable[];
  groupId: string;
  employeeId: string;
  status: RsvpStatus;
  /** History excluding the day being replied about. */
  pastMatches: readonly PastMatch[];
  config: MatchConfig;
}

/**
 * Records the reply and, when a decline leaves a table too small, moves the
 * people still coming to other tables with room. Returns the tables that
 * changed.
 */
export function applyRsvp(options: ApplyRsvpOptions): SeatedTable[] {
  const { tables, groupId, employeeId, status, config } = options;

  const table = tables.find((t) => t.id === groupId);
  if (!table || !(employeeId in table.rsvps)) return [];

  const changed = new Set<SeatedTable>([table]);
  table.rsvps[employeeId] = status;

  const history = new MatchHistory(
    options.pastMatches.filter((m) => m.date !== table.date),
    table.date,
  );
  const hosts = tables.filter((t) => t.id !== table.id && !t.cancelled);

  if (table.cancelled) {
    // A dissolved table does not come back; the others have already been moved.
    // Someone changing their mind gets a seat of their own instead.
    const person = table.members.find((m) => m.id === employeeId);
    if (person && status !== 'declined') {
      moveOut(table, [person], hosts, history, config, changed);
    }
    return [...changed];
  }

  const stillComing = table.members.filter((m) => table.rsvps[m.id] !== 'declined');
  if (stillComing.length >= config.minGroupSize) return [...changed];

  // A table of two is a meeting, not a lunch. The invite promises to reseat
  // people who are left behind, so do that before giving up on them.
  moveOut(table, stillComing, hosts, history, config, changed);
  table.cancelled = true;
  table.sequence += 1;
  return [...changed];
}

function moveOut(
  table: SeatedTable,
  people: readonly Employee[],
  hosts: readonly SeatedTable[],
  history: MatchHistory,
  config: MatchConfig,
  changed: Set<SeatedTable>,
): void {
  for (const person of people) {
    const host = findHost(hosts, person, history, config);
    if (!host) continue;

    host.members.push(person);
    host.rsvps[person.id] = table.rsvps[person.id] ?? 'pending';
    // The table changed after the invite went out, so it needs re-sending, as
    // an update to the same event rather than a second one.
    host.sequence += 1;
    host.invitesSentAt = null;
    host.cancellationSentAt = null;
    changed.add(host);

    table.members = table.members.filter((m) => m.id !== person.id);
    delete table.rsvps[person.id];
  }
}

/**
 * Tables are three or four by design, so on a day where every table is full
 * there is no free seat to move anyone into. Rather than send someone away, a
 * receiving table may go to five, but only after every table with genuine room,
 * and every relaxation of the matching rules, has been tried first.
 */
function findHost(
  hosts: readonly SeatedTable[],
  person: Employee,
  history: MatchHistory,
  config: MatchConfig,
): SeatedTable | null {
  for (const capacity of [config.maxGroupSize, config.maxGroupSize + 1]) {
    for (const relaxation of RELAXATION_LADDER) {
      const host = hosts.find(
        (g) =>
          g.members.filter((m) => g.rsvps[m.id] !== 'declined').length < capacity &&
          canJoin(g.members, person, history, config, relaxation),
      );
      if (host) return host;
    }
  }
  return null;
}
