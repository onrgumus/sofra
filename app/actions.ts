'use server';

import { revalidatePath } from 'next/cache';
import { getStore } from '../src/store/instance';
import { planDay } from '../src/lib/nightly';
import { deliverPending } from '../src/lib/notifications';
import { configuredChannel, FROM_EMAIL } from '../src/lib/channel';
import { endSession, startSession } from '../src/lib/session';
import { checkPassword } from '../src/lib/auth';
import { safeRedirectPath } from '../src/lib/redirect';
import { checkSignInAllowed, clearSignInFailures, recordSignInFailure } from '../src/lib/throttle';
import { demoModeEnabled, isAdmin } from '../src/lib/authz';
import type { Employee } from '../src/core/types';
import { parseInterests } from '../src/core/profile';
import { currentEmployeeId } from '../src/lib/session';
import { DEMO_USERNAME, pickRandomColleague } from '../src/store/featured';
import { redirect } from 'next/navigation';
import { SLOT } from '../src/store/demo';
import type { RsvpStatus } from '../src/store/types';

function refresh(): void {
  revalidatePath('/', 'layout');
}

/**
 * The console's buttons re-plan a whole office's day and mail everyone in it.
 * Guarding only the page would leave the actions callable directly, which is
 * the same hole with an extra step.
 */
async function requireAdmin(): Promise<Employee | null> {
  const store = getStore();
  const employeeId = await currentEmployeeId(store);
  const employee = employeeId ? await store.getEmployee(employeeId) : undefined;
  return employee && (await isAdmin(store, employee)) ? employee : null;
}

/**
 * The person this request is acting as.
 *
 * From the session, never from the form. A hidden `employeeId` field is a
 * request from the browser, and a browser is whoever is holding it: taking it
 * at its word let any signed-in employee decline a colleague's lunch, opt them
 * into one, or mark them out of the office and collapse their table. Becoming
 * somebody else has exactly one door, `switchEmployee`, and that one is gated.
 */
async function actingEmployee(): Promise<Employee | null> {
  const store = getStore();
  const employeeId = await currentEmployeeId(store);
  if (!employeeId) return null;
  return (await store.getEmployee(employeeId)) ?? null;
}

function required(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== 'string' || value === '') throw new Error(`Missing field: ${field}`);
  return value;
}

export async function signIn(formData: FormData): Promise<void> {
  const username = String(formData.get('username') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const asColleague = formData.get('mode') === 'random';
  const next = safeRedirectPath(formData.get('next'));

  const store = getStore();

  // A short password with no limit is not a password. Counted per username, so
  // an attacker cannot lock out an office by hammering from one address.
  const throttle = await checkSignInAllowed(store, username);
  if (!throttle.allowed) {
    redirect(`/login?error=throttled&next=${encodeURIComponent(next)}`);
  }

  const employee = asColleague
    ? await pickRandomColleague(store)
    : username === DEMO_USERNAME
      ? await store.getEmployee(DEMO_USERNAME)
      : (await store.listEmployees()).find((e) => e.email.toLowerCase() === username);

  if (!employee || !checkPassword(password)) {
    await recordSignInFailure(store, username);
    // Same message either way: which half was wrong is not the visitor's
    // business, and saying so only helps someone guessing usernames.
    redirect(`/login?error=bad-credentials&next=${encodeURIComponent(next)}`);
  }

  // A password that worked clears the count, so an honest typo costs nothing.
  await clearSignInFailures(store, username);
  await startSession(employee.id);
  redirect(next);
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect('/login');
}

/** Demo affordance: look at the same day through a colleague's eyes. */
export async function switchEmployee(formData: FormData): Promise<void> {
  // Becoming a colleague is a demo affordance, not a feature.
  if (!demoModeEnabled()) return;

  const employeeId = required(formData, 'employeeId');
  if (!(await getStore().getEmployee(employeeId))) return;

  await startSession(employeeId);
  refresh();
}

export async function setAttendance(formData: FormData): Promise<void> {
  const me = await actingEmployee();
  if (!me) return;

  const store = getStore();
  const date = required(formData, 'date');
  const officeId = required(formData, 'officeId');
  const attending = formData.get('attending') === 'true';

  await store.setSelfDeclaredAttendance(me.id, date, officeId, attending);

  // Dropping out of the office can collapse a table and move people, exactly as
  // a decline does, so the same mail has to go out.
  if (!attending) {
    await deliverPending({
      store,
      channel: configuredChannel(),
      from: FROM_EMAIL,
      date,
      officeId,
    });
  }
  refresh();
}

/**
 * Raise or lower your hand for one specific day. Being in the office says
 * nothing about this: most office days you are there to work with your own team,
 * and Sofra only acts on the days you actively ask it to.
 */
export async function toggleLunch(formData: FormData): Promise<void> {
  const me = await actingEmployee();
  if (!me) return;

  const store = getStore();
  const employeeId = me.id;
  const date = required(formData, 'date');
  const officeId = required(formData, 'officeId');

  if (formData.get('wantsLunch') === 'on') {
    await store.setOptIn({ employeeId, date, officeId, slot: SLOT });
  } else {
    await store.removeOptIn(employeeId, date, officeId);
  }
  refresh();
}

/**
 * Turn the daily question on or off for yourself.
 *
 * Takes the id from the session rather than the form: an opt-out somebody else
 * can set for you is not an opt-out, and the only person who gets to decide
 * whether you are asked is you.
 */
export async function setReminders(formData: FormData): Promise<void> {
  const store = getStore();
  const employeeId = await currentEmployeeId(store);
  if (!employeeId) return;

  await store.setReminders(employeeId, formData.get('enabled') === 'true');
  refresh();
}

/**
 * Your own languages and interests.
 *
 * The only employee data anybody edits here, because it is the only employee
 * data the company directory does not have. Name, role and department stay
 * read-only: letting somebody change their department in Sofra would be a way
 * to pick who they get seated with, which is the one thing the matcher is for.
 */
export async function updateProfile(formData: FormData): Promise<void> {
  const me = await actingEmployee();
  if (!me) return;

  const store = getStore();
  const languages = formData.getAll('languages').filter((v): v is string => typeof v === 'string');

  await store.setProfile({
    employeeId: me.id,
    // A table needs a language everyone shares, so somebody with none cannot be
    // seated at all. Keeping what they had beats silently removing them.
    languages: languages.length > 0 ? languages : me.languages,
    interests: parseInterests(String(formData.get('interests') ?? '')),
    updatedAt: new Date().toISOString(),
  });
  refresh();
}

/**
 * The admin console's "run matching" button. Same code path the nightly job
 * takes, so what you see here is what the cron will produce.
 */
export async function runMatching(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  await planDay(getStore(), required(formData, 'officeId'), required(formData, 'date'));
  refresh();
}

export async function clearMatching(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  await getStore().clearGroups(required(formData, 'date'), required(formData, 'officeId'));
  refresh();
}

export async function sendInvites(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  await deliverPending({
    store: getStore(),
    channel: configuredChannel(),
    from: FROM_EMAIL,
    date: required(formData, 'date'),
    officeId: required(formData, 'officeId'),
  });
  refresh();
}

export async function respondToInvite(formData: FormData): Promise<void> {
  const me = await actingEmployee();
  if (!me) return;

  const store = getStore();
  const groupId = required(formData, 'groupId');
  const group = await store.getGroup(groupId);
  if (!group) return;

  // Only for your own seat, at your own table. Replying for somebody else can
  // collapse their table and mail three other people about it.
  if (!group.members.some((m) => m.id === me.id)) return;

  await store.setRsvp(groupId, me.id, required(formData, 'status') as RsvpStatus);

  // A reply can collapse a table and move people to other ones. Both the
  // cancellation and the reseated tables' new invites go out now, not whenever
  // an admin next remembers to press a button.
  await deliverPending({
    store,
    channel: configuredChannel(),
    from: FROM_EMAIL,
    date: group.date,
    officeId: group.officeId,
  });
  refresh();
}

/**
 * Give somebody the console.
 *
 * Recorded with who did it and when, so "why can this person see everyone's
 * replies" has an answer that does not depend on anybody remembering.
 */
export async function grantAdmin(formData: FormData): Promise<void> {
  const granter = await requireAdmin();
  if (!granter) return;

  const store = getStore();
  const employeeId = required(formData, 'employeeId');
  if (!(await store.getEmployee(employeeId))) return;

  await store.grantAdmin({
    employeeId,
    grantedBy: granter.id,
    grantedAt: new Date().toISOString(),
  });
  refresh();
}

export async function revokeAdmin(formData: FormData): Promise<void> {
  const revoker = await requireAdmin();
  if (!revoker) return;

  const store = getStore();
  const employeeId = required(formData, 'employeeId');

  // Removing yourself is how a company ends up with no administrator at all,
  // and the bootstrap list is the way back in rather than a thing to lean on.
  if (employeeId === revoker.id) return;

  await store.revokeAdmin(employeeId);
  refresh();
}
