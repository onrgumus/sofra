import { beforeEach, describe, expect, it } from 'vitest';
import { DemoStore, SLOT } from '../src/store/demo';
import { matchLunches } from '../src/core/matcher';
import { todayInZone, upcomingWeekdays } from '../src/lib/dates';

const OFFICE = 'IST-HQ';

describe('DemoStore', () => {
  let store: DemoStore;
  let date: string;

  beforeEach(() => {
    store = new DemoStore(7, 120);
    date = upcomingWeekdays(1, todayInZone('Europe/Istanbul'))[0]!;
  });

  it('seeds a company split across the configured offices', () => {
    expect(store.listEmployees()).toHaveLength(120);
    expect(store.listEmployees(OFFICE).length).toBeGreaterThan(0);
    expect(store.listEmployees(OFFICE).every((e) => e.officeId === OFFICE)).toBe(true);
  });

  it('reports seeded office days as coming from the desk-booking feed', async () => {
    const attending = await store.getAttendance(date, OFFICE);
    expect(attending.length).toBeGreaterThan(0);
    expect(await store.attendanceSource(attending[0]!, date, OFFICE)).toBe('desk-booking');
  });

  it('lets someone declare an office day the desk feed does not know about', async () => {
    const attending = new Set(await store.getAttendance(date, OFFICE));
    const absent = store.listEmployees(OFFICE).find((e) => !attending.has(e.id))!;

    expect(await store.attendanceSource(absent.id, date, OFFICE)).toBeNull();
    store.setSelfDeclaredAttendance(absent.id, date, OFFICE, true);

    expect(await store.attendanceSource(absent.id, date, OFFICE)).toBe('self-declared');
    expect(await store.getAttendance(date, OFFICE)).toContain(absent.id);
  });

  it('lets someone override the desk feed when plans change', async () => {
    const [booked] = await store.getAttendance(date, OFFICE);
    store.setSelfDeclaredAttendance(booked!, date, OFFICE, false);

    // We cannot edit the desk-booking system, so we suppress it on our side.
    expect(await store.getAttendance(date, OFFICE)).not.toContain(booked);
    expect(await store.attendanceSource(booked!, date, OFFICE)).toBeNull();
  });

  it('drops the lunch opt-in when someone stops coming in', async () => {
    const [booked] = await store.getAttendance(date, OFFICE);
    store.setOptIn({
      employeeId: booked!,
      date,
      officeId: OFFICE,
      slot: SLOT,
    });
    expect(store.getOptIn(booked!, date, OFFICE)).not.toBeNull();

    store.setSelfDeclaredAttendance(booked!, date, OFFICE, false);
    expect(store.getOptIn(booked!, date, OFFICE)).toBeNull();
  });

  it('seeds past lunches so the first real run already avoids repeats', () => {
    expect(store.listPastMatches().length).toBeGreaterThan(0);
  });

  it('never seeds a lunch request for someone who is not in the office', async () => {
    // Otherwise the day row shows "Not in the office" and "Lunch at 12:00" side
    // by side, which is a straight contradiction to whoever is reading it.
    for (const date of upcomingWeekdays(5, todayInZone('Europe/Istanbul'))) {
      const attending = new Set(await store.getAttendance(date, OFFICE));
      for (const optIn of store.listOptIns(date, OFFICE)) {
        expect(attending.has(optIn.employeeId)).toBe(true);
      }
    }
  });

  it('gives everyone a distinct name', () => {
    // People pick their lunch companions out of an invite by name; two identical
    // names make the invite ambiguous and the matcher's output uncheckable.
    const names = store.listEmployees().map((e) => e.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  async function planLunches() {
    const attending = await store.getAttendance(date, OFFICE);
    const optIns = attending.slice(0, 16).map((employeeId) => ({
      employeeId,
      date,
      officeId: OFFICE,
      slot: SLOT,
    }));
    for (const optIn of optIns) store.setOptIn(optIn);

    const result = matchLunches({
      date,
      officeId: OFFICE,
      slot: SLOT,
      employees: store.listEmployees(),
      optIns,
      pastMatches: store.listPastMatches().filter((m) => m.date !== date),
    });
    store.saveMatchResult(result);
    return result;
  }

  it('stores tables with everyone pending a reply', async () => {
    await planLunches();
    const groups = store.listGroups(date, OFFICE);

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(Object.values(group.rsvps).every((s) => s === 'pending')).toBe(true);
      expect(group.invitesSentAt).toBeNull();
      expect(group.cancelled).toBe(false);
    }
  });

  it('finds the table a given person was seated at', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE)[0]!;
    const member = group.members[0]!;
    expect(store.groupForEmployee(member.id, date, OFFICE)?.id).toBe(group.id);
  });

  it('replaces the previous plan when matching is re-run', async () => {
    await planLunches();
    const firstIds = store.listGroups(date, OFFICE).map((g) => g.id);
    await planLunches();
    const groups = store.listGroups(date, OFFICE);

    // Same day matched twice must not accumulate two sets of tables.
    expect(groups.length).toBe(firstIds.length);
    expect(store.listGroups(date, OFFICE).every((g) => g.date === date)).toBe(true);
  });

  it('cancels a table once too many people drop out', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;

    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    expect(store.getGroup(group.id)?.cancelled).toBe(false);

    store.setRsvp(group.id, group.members[1]!.id, 'declined');
    expect(store.getGroup(group.id)?.cancelled).toBe(true);
  });

  it('reseats the people still coming instead of stranding them', async () => {
    // The invite promises "let us know so we can reseat the table". Before this,
    // it cancelled and left the two people who still wanted lunch with nothing.
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    const [outA, outB, stayA, stayB] = group.members;

    store.setRsvp(group.id, stayA!.id, 'accepted');
    store.setRsvp(group.id, outA!.id, 'declined');
    store.setRsvp(group.id, outB!.id, 'declined');

    expect(store.getGroup(group.id)?.cancelled).toBe(true);
    for (const person of [stayA!, stayB!]) {
      const seat = store.groupForEmployee(person.id, date, OFFICE);
      expect(seat).not.toBeNull();
      expect(seat!.id).not.toBe(group.id);
      expect(seat!.cancelled).toBe(false);
    }
  });

  it('keeps a reply when someone is moved to another table', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    const stayer = group.members[3]!;

    store.setRsvp(group.id, stayer.id, 'accepted');
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    const seat = store.groupForEmployee(stayer.id, date, OFFICE)!;
    expect(seat.rsvps[stayer.id]).toBe('accepted');
  });

  it('marks a table that gained someone as needing a fresh invite', async () => {
    await planLunches();
    store.markInvitesSent(date, OFFICE);

    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    const hosts = store
      .listGroups(date, OFFICE)
      .filter((g) => !g.cancelled && g.invitesSentAt === null);
    expect(hosts.length).toBeGreaterThan(0);
    // Sequence bumped, so the calendar updates the event rather than duplicating.
    expect(hosts.every((g) => g.sequence > 0)).toBe(true);
  });

  it('never seats someone at a table with a teammate while reseating', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    for (const host of store.listGroups(date, OFFICE).filter((g) => !g.cancelled)) {
      const teams = host.members.map((m) => m.team);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it('does not let a reseated table exceed the maximum size', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    for (const host of store.listGroups(date, OFFICE).filter((g) => !g.cancelled)) {
      const coming = host.members.filter((m) => host.rsvps[m.id] !== 'declined');
      // Five is the documented ceiling for a table that absorbed someone whose
      // own table collapsed; six would be a crowd, and nobody asked for that.
      expect(coming.length).toBeLessThanOrEqual(5);
    }
  });

  it('un-declining a dissolved table gets you a seat, not the old table back', async () => {
    // Once the others have been moved, resurrecting the table would put them in
    // two places at once. The person who changed their mind is reseated instead.
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    const mindChanger = group.members[1]!;

    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, mindChanger.id, 'declined');
    expect(store.getGroup(group.id)?.cancelled).toBe(true);

    store.setRsvp(group.id, mindChanger.id, 'accepted');
    expect(store.getGroup(group.id)?.cancelled).toBe(true);

    const seat = store.groupForEmployee(mindChanger.id, date, OFFICE);
    expect(seat?.cancelled).toBe(false);
    expect(seat?.id).not.toBe(group.id);
  });

  it('keeps a table alive when one decline still leaves three people', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;

    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    expect(store.getGroup(group.id)?.cancelled).toBe(false);
    expect(store.getGroup(group.id)?.members).toHaveLength(4);
  });

  it('does not mark cancelled tables as invited', async () => {
    await planLunches();
    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    store.markInvitesSent(date, OFFICE);
    expect(store.getGroup(group.id)?.invitesSentAt).toBeNull();
    expect(store.listGroups(date, OFFICE).filter((g) => g.invitesSentAt !== null).length)
      .toBeGreaterThan(0);
  });

  it('records who could not be seated, and forgets it when cleared', async () => {
    const result = await planLunches();
    expect(store.listUnmatched(date, OFFICE)).toEqual(result.unmatched);

    store.clearGroups(date, OFFICE);
    expect(store.listGroups(date, OFFICE)).toEqual([]);
    expect(store.listUnmatched(date, OFFICE)).toEqual([]);
  });

  it('keeps today out of its own history so a re-run is not poisoned', async () => {
    await planLunches();
    // Saved groups land in listPastMatches; the caller must exclude the day it is
    // planning or every pair looks like a repeat.
    expect(store.listPastMatches().some((m) => m.date === date)).toBe(true);
    const prior = store.listPastMatches().filter((m) => m.date !== date);
    expect(prior.some((m) => m.date === date)).toBe(false);
  });
});
