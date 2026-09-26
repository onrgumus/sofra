'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin, type AdminContext } from '../../src/auth/session';
import { bootstrapAdminEmails } from '../../src/auth/roles';
import { getDb } from '../../src/db';
import { addGrant, grantsOf, recordAudit, removeGrant } from '../../src/data/admin';
import {
  addHoliday,
  createOffice,
  getOffice,
  listOffices,
  removeHoliday,
  updateOffice,
} from '../../src/data/offices';
import { getPerson, setActive, setOffice } from '../../src/data/people';
import { deleteSessionsOf } from '../../src/data/sessions';
import {
  addAllowedDomain,
  addDepartment,
  removeAllowedDomain,
  removeDepartment,
  renameDepartment,
  setSetting,
} from '../../src/data/settings';
import { configuredDirectory } from '../../src/lib/directory';
import { isValidDate } from '../../src/lib/zoned';
import { syncDirectory } from '../../src/services/directory-sync';
import { parseOfficeForm, type FormErrors } from '../../src/services/forms';
import { tickDeps } from '../../src/services/runtime';
import { planNow, remindNow } from '../../src/services/tick';

function field(formData: FormData, key: string, max = 200): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function audit(
  admin: AdminContext,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await recordAudit(getDb(), {
    actorId: admin.person.id,
    actorEmail: admin.person.email,
    action,
    target,
    details,
  });
}

// --- offices -----------------------------------------------------------------

export interface OfficeFormState {
  errors: FormErrors;
  values: Record<string, string>;
}

/**
 * Creates an office (every-office admins only) or updates one (anybody who
 * administers it). The id is fixed once created: tables, requests and people
 * point at it.
 */
export async function saveOfficeAction(
  _previous: OfficeFormState,
  formData: FormData,
): Promise<OfficeFormState> {
  const existingId = field(formData, 'existingId', 40) || undefined;
  const admin = existingId
    ? await requireAdmin({ officeId: existingId })
    : await requireAdmin({ everyOffice: true });
  const db = getDb();

  const parsed = parseOfficeForm(formData, existingId);
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values };

  if (existingId) {
    const before = await getOffice(db, existingId);
    if (!before) return { errors: { form: 'That office no longer exists.' }, values: {} };
    await updateOffice(db, parsed.value);
    await audit(admin, 'office.update', existingId, { before, after: parsed.value });
  } else {
    if (await getOffice(db, parsed.value.id)) {
      return { errors: { id: 'An office with this id already exists.' }, values: {} };
    }
    await createOffice(db, parsed.value);
    await audit(admin, 'office.create', parsed.value.id, { office: parsed.value });
  }

  revalidatePath('/admin', 'layout');
  redirect(`/admin/offices/${encodeURIComponent(parsed.value.id)}?saved=1`);
}

export async function addHolidayAction(formData: FormData): Promise<void> {
  const officeId = field(formData, 'officeId', 40);
  const admin = await requireAdmin({ officeId });
  const date = field(formData, 'date', 10);
  const name = field(formData, 'name', 80);
  if (!isValidDate(date)) redirect(`/admin/offices/${encodeURIComponent(officeId)}?error=date`);

  await addHoliday(getDb(), { officeId, date, name });
  await audit(admin, 'holiday.add', officeId, { date, name });
  revalidatePath(`/admin/offices/${officeId}`);
  redirect(`/admin/offices/${encodeURIComponent(officeId)}#holidays`);
}

export async function removeHolidayAction(formData: FormData): Promise<void> {
  const officeId = field(formData, 'officeId', 40);
  const admin = await requireAdmin({ officeId });
  const date = field(formData, 'date', 10);
  await removeHoliday(getDb(), officeId, date);
  await audit(admin, 'holiday.remove', officeId, { date });
  revalidatePath(`/admin/offices/${officeId}`);
  redirect(`/admin/offices/${encodeURIComponent(officeId)}#holidays`);
}

// --- the day --------------------------------------------------------------------

/** Plans a day now. Re-planning cancels the invites people already have. */
export async function planNowAction(formData: FormData): Promise<void> {
  const officeId = field(formData, 'officeId', 40);
  const admin = await requireAdmin({ officeId });
  const date = field(formData, 'date', 10);
  const office = await getOffice(getDb(), officeId);
  if (!office || !isValidDate(date)) redirect('/admin');

  const result = await planNow(tickDeps(), office, date);
  await audit(admin, 'match.run', officeId, {
    date,
    status: result.status,
    summary: result.summary ?? {},
  });
  revalidatePath('/admin');
  redirect(
    `/admin?office=${encodeURIComponent(officeId)}&date=${date}&note=${result.status === 'done' ? 'planned' : 'failed'}`,
  );
}

export async function remindNowAction(formData: FormData): Promise<void> {
  const officeId = field(formData, 'officeId', 40);
  const admin = await requireAdmin({ officeId });
  const date = field(formData, 'date', 10);
  const office = await getOffice(getDb(), officeId);
  if (!office || !isValidDate(date)) redirect('/admin');

  const result = await remindNow(tickDeps(), office, date);
  await audit(admin, 'reminder.run', officeId, { date, summary: result.summary ?? {} });
  redirect(
    `/admin?office=${encodeURIComponent(officeId)}&date=${date}&note=${result.status === 'done' ? 'reminded' : 'failed'}`,
  );
}

// --- company settings (every-office admins) -------------------------------------

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

export async function addDomainAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const domain = field(formData, 'domain', 100).toLowerCase().replace(/^@/, '');
  if (!DOMAIN.test(domain)) redirect('/admin/settings?error=domain');
  await addAllowedDomain(getDb(), domain);
  await audit(admin, 'domain.add', domain);
  redirect('/admin/settings?saved=domain');
}

export async function removeDomainAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const domain = field(formData, 'domain', 100);
  await removeAllowedDomain(getDb(), domain);
  await audit(admin, 'domain.remove', domain);
  redirect('/admin/settings');
}

export async function addDepartmentAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const name = field(formData, 'name', 80);
  if (!name) redirect('/admin/settings?error=department');
  const saved = await addDepartment(getDb(), name);
  await audit(admin, 'department.add', saved);
  redirect('/admin/settings?saved=department');
}

export async function renameDepartmentAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const from = field(formData, 'from', 80);
  const to = field(formData, 'to', 80);
  if (!to) redirect('/admin/settings?error=department');
  try {
    await renameDepartment(getDb(), from, to);
  } catch {
    redirect('/admin/settings?error=rename');
  }
  await audit(admin, 'department.rename', from, { to });
  redirect('/admin/settings?saved=department');
}

export async function removeDepartmentAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const name = field(formData, 'name', 80);
  const removed = await removeDepartment(getDb(), name);
  if (!removed) redirect('/admin/settings?error=inuse');
  await audit(admin, 'department.remove', name);
  redirect('/admin/settings');
}

export async function setCompanyNameAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const name = field(formData, 'companyName', 80);
  await setSetting(getDb(), 'company_name', name || 'your company');
  await audit(admin, 'company.rename', name);
  redirect('/admin/settings?saved=company');
}

export async function syncDirectoryAction(): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const db = getDb();
  const configured = configuredDirectory(await listOffices(db));
  if (!configured) redirect('/admin/people?error=nodirectory');
  const summary = await syncDirectory(db, configured.directory, configured.source);
  await audit(admin, 'directory.sync', configured.source, { ...summary });
  redirect(`/admin/people?synced=${summary.created}-${summary.updated}-${summary.deactivated}`);
}

// --- people (every-office admins) -----------------------------------------------

async function targetPerson(formData: FormData) {
  const person = await getPerson(getDb(), field(formData, 'employeeId', 64));
  if (!person) redirect('/admin/people');
  return person;
}

/**
 * Deactivating somebody signs them out everywhere at once and stops them
 * signing back in; their past lunches stay, for everyone else's history.
 */
export async function setPersonActiveAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const person = await targetPerson(formData);
  const active = field(formData, 'active') === 'true';

  if (!active && person.id === admin.person.id) redirect('/admin/people?error=self');
  if (!active && bootstrapAdminEmails().includes(person.email)) {
    redirect('/admin/people?error=bootstrap');
  }

  const db = getDb();
  await setActive(db, person.id, active);
  if (!active) await deleteSessionsOf(db, person.id);
  await audit(admin, active ? 'person.reactivate' : 'person.deactivate', person.email);
  revalidatePath('/admin/people');
  redirect(`/admin/people?q=${encodeURIComponent(person.email)}`);
}

export async function signOutPersonAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const person = await targetPerson(formData);
  const count = await deleteSessionsOf(getDb(), person.id);
  await audit(admin, 'person.signout', person.email, { sessions: count });
  redirect(`/admin/people?q=${encodeURIComponent(person.email)}&note=signedout`);
}

export async function setPersonOfficeAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const person = await targetPerson(formData);
  const officeId = field(formData, 'officeId', 40) || null;
  if (officeId && !(await getOffice(getDb(), officeId))) redirect('/admin/people');
  await setOffice(getDb(), person.id, officeId);
  await audit(admin, 'person.office', person.email, { from: person.officeId, to: officeId });
  redirect(`/admin/people?q=${encodeURIComponent(person.email)}`);
}

/** Makes somebody an admin of every office, or of one. Only every-office admins can. */
export async function grantAdminAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const person = await targetPerson(formData);
  if (!person.active) redirect('/admin/people?error=inactive');
  const officeId = field(formData, 'officeId', 40) || null;
  if (officeId && !(await getOffice(getDb(), officeId))) redirect('/admin/people');

  await addGrant(getDb(), { employeeId: person.id, officeId, grantedBy: admin.person.id });
  await audit(admin, 'admin.grant', person.email, { officeId: officeId ?? 'every office' });
  redirect(`/admin/people?q=${encodeURIComponent(person.email)}`);
}

export async function revokeAdminAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin({ everyOffice: true });
  const grantId = Number(field(formData, 'grantId', 20));
  const db = getDb();

  // Not your own last every-office grant: that is how a company ends up with
  // no administrator, and the bootstrap list is the way back, not the plan.
  const own = await grantsOf(db, admin.person.id);
  const target = own.find((g) => g.id === grantId);
  if (target && target.officeId === null && !admin.role.bootstrap) {
    redirect('/admin/people?error=self');
  }

  const removed = await removeGrant(db, grantId);
  if (removed) {
    const person = await getPerson(db, removed.employeeId);
    await audit(admin, 'admin.revoke', person?.email ?? removed.employeeId, {
      officeId: removed.officeId ?? 'every office',
    });
  }
  redirect('/admin/people');
}
