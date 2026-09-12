'use server';

import { revalidatePath } from 'next/cache';
import { matchLunches } from '../src/core/matcher';
import { buildInvite } from '../src/notify/invite';
import { ConsoleTransport, sendInvite } from '../src/notify/transport';
import { getStore } from '../src/store/instance';
import { toVenue } from '../src/lib/venue';
import { SLOT } from '../src/store/demo';
import type { RsvpStatus } from '../src/store/types';

function refresh(): void {
  revalidatePath('/', 'layout');
}

function required(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== 'string' || value === '') throw new Error(`Missing field: ${field}`);
  return value;
}

export async function switchEmployee(formData: FormData): Promise<void> {
  getStore().setCurrentEmployeeId(required(formData, 'employeeId'));
  refresh();
}

export async function setAttendance(formData: FormData): Promise<void> {
  const store = getStore();
  store.setSelfDeclaredAttendance(
    required(formData, 'employeeId'),
    required(formData, 'date'),
    required(formData, 'officeId'),
    formData.get('attending') === 'true',
  );
  refresh();
}

/**
 * Raise or lower your hand for one specific day. Being in the office says
 * nothing about this: most office days you are there to work with your own team,
 * and Sofra only acts on the days you actively ask it to.
 */
export async function toggleLunch(formData: FormData): Promise<void> {
  const store = getStore();
  const employeeId = required(formData, 'employeeId');
  const date = required(formData, 'date');
  const officeId = required(formData, 'officeId');

  if (formData.get('wantsLunch') === 'on') {
    store.setOptIn({ employeeId, date, officeId, slot: SLOT });
  } else {
    store.removeOptIn(employeeId, date, officeId);
  }
  refresh();
}

/**
 * What the nightly cron job will call. Everyone who opted in *and* is actually in
 * the building that day goes into the pool — the attendance provider is the
 * gate, which is why no desk-booking integration is needed anywhere else.
 */
export async function runMatching(formData: FormData): Promise<void> {
  const store = getStore();
  const date = required(formData, 'date');
  const officeId = required(formData, 'officeId');

  const attending = new Set(await store.getAttendance(date, officeId));
  const optIns = store.listOptIns(date, officeId).filter((o) => attending.has(o.employeeId));

  store.saveMatchResult(
    matchLunches({
      date,
      officeId,
      slot: SLOT,
      employees: store.listEmployees(),
      optIns,
      // Exclude this day: re-running must not treat the plan it is replacing as
      // a past lunch, which would make every pair look like a repeat.
      pastMatches: store.listPastMatches().filter((m) => m.date !== date),
    }),
  );
  refresh();
}

export async function clearMatching(formData: FormData): Promise<void> {
  getStore().clearGroups(required(formData, 'date'), required(formData, 'officeId'));
  refresh();
}

export async function sendInvites(formData: FormData): Promise<void> {
  const store = getStore();
  const date = required(formData, 'date');
  const officeId = required(formData, 'officeId');

  const office = store.getOffice(officeId);
  if (!office) return;

  const transport = new ConsoleTransport();
  for (const group of store.listGroups(date, officeId)) {
    if (group.cancelled) continue;
    const invite = buildInvite({
      group,
      venue: toVenue(office),
      organizer: { name: 'Sofra', email: 'sofra@example.com' },
      confirmUrl: `http://localhost:3000/c/${group.id}`,
    });
    await sendInvite(transport, invite, { from: 'Sofra <sofra@example.com>' });
  }

  store.markInvitesSent(date, officeId);
  refresh();
}

export async function respondToInvite(formData: FormData): Promise<void> {
  getStore().setRsvp(
    required(formData, 'groupId'),
    required(formData, 'employeeId'),
    required(formData, 'status') as RsvpStatus,
  );
  refresh();
}
