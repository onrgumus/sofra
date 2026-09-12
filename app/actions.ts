'use server';

import { revalidatePath } from 'next/cache';
import { ConsoleTransport } from '../src/notify/transport';
import { getStore } from '../src/store/instance';
import { planDay } from '../src/lib/nightly';
import { deliverPending } from '../src/lib/notifications';
const FROM_EMAIL = process.env.SOFRA_FROM_EMAIL ?? 'Sofra <sofra@example.com>';
import { setCurrentEmployeeId } from '../src/lib/session';
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
  const employeeId = required(formData, 'employeeId');
  if (!getStore().getEmployee(employeeId)) return;

  await setCurrentEmployeeId(employeeId);
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
 * The admin console's "run matching" button. Same code path the nightly job
 * takes, so what you see here is what the cron will produce.
 */
export async function runMatching(formData: FormData): Promise<void> {
  await planDay(getStore(), required(formData, 'officeId'), required(formData, 'date'));
  refresh();
}

export async function clearMatching(formData: FormData): Promise<void> {
  getStore().clearGroups(required(formData, 'date'), required(formData, 'officeId'));
  refresh();
}

export async function sendInvites(formData: FormData): Promise<void> {
  await deliverPending({
    store: getStore(),
    transport: new ConsoleTransport(),
    from: FROM_EMAIL,
    date: required(formData, 'date'),
    officeId: required(formData, 'officeId'),
  });
  refresh();
}

export async function respondToInvite(formData: FormData): Promise<void> {
  const store = getStore();
  const groupId = required(formData, 'groupId');
  const group = store.getGroup(groupId);
  if (!group) return;

  store.setRsvp(
    groupId,
    required(formData, 'employeeId'),
    required(formData, 'status') as RsvpStatus,
  );

  // A reply can collapse a table and move people to other ones. Both the
  // cancellation and the reseated tables' new invites go out now, not whenever
  // an admin next remembers to press a button.
  await deliverPending({
    store,
    transport: new ConsoleTransport(),
    from: FROM_EMAIL,
    date: group.date,
    officeId: group.officeId,
  });
  refresh();
}
