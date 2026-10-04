'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePerson } from '../../src/auth/session';
import { getDb } from '../../src/db';
import { listOffices } from '../../src/data/offices';
import { saveProfile, setReminders } from '../../src/data/people';
import { listDepartments } from '../../src/data/settings';
import { parseProfileForm, type FormErrors } from '../../src/services/forms';

export interface ProfileFormState {
  errors: FormErrors;
  values: Record<string, string>;
}

/**
 * Saves what somebody says about themselves, on the welcome page and their own
 * page alike. The first save is what makes them somebody who can be seated.
 */
export async function saveProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { person, session } = await requirePerson();
  // A guest in a public demo keeps the invented colleague they were given:
  // what they typed would be shown to the next visitor seated beside them.
  if (session.method === 'demo') redirect('/you?guest=1');

  const db = getDb();
  const parsed = parseProfileForm(formData, {
    departments: await listDepartments(db),
    officeIds: (await listOffices(db, { activeOnly: true })).map((o) => o.id),
    today: new Date().toISOString().slice(0, 10),
  });
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values };

  const { reminders, ...profile } = parsed.value;
  const firstTime = person.onboardedAt === null;
  // A team the directory worked out (the people with the same manager) is not
  // shown in the form; an empty box must not erase it.
  if (!profile.team && person.team.startsWith('manager:')) profile.team = person.team;
  await saveProfile(db, person.id, profile);
  await setReminders(db, person.id, reminders);

  revalidatePath('/', 'layout');
  redirect(firstTime ? '/?note=welcome' : '/you?saved=1');
}

export async function setRemindersAction(formData: FormData): Promise<void> {
  const { person } = await requirePerson();
  await setReminders(getDb(), person.id, formData.get('enabled') === 'true');
  revalidatePath('/you');
  redirect('/you');
}
