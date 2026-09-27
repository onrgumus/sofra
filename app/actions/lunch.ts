'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOnboarded } from '../../src/auth/session';
import { getDb } from '../../src/db';
import { setPattern } from '../../src/data/lunch';
import type { RsvpStatus, Weekday } from '../../src/data/types';
import { isValidDate } from '../../src/lib/zoned';
import { dropLunch, respond, wantLunch, type DayOutcome } from '../../src/services/days';
import { dayDeps } from '../../src/services/runtime';

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Back to the calendar, on the day that changed, with what happened. */
function back(date: string, outcome: DayOutcome): never {
  const note = outcome.ok ? 'saved' : outcome.reason;
  redirect(`/?day=${encodeURIComponent(date)}&note=${encodeURIComponent(note)}#${date}`);
}

/**
 * "I'll be in and I want lunch" or "not this time", for one day. The person is
 * always the one signed in; nothing in the form says who.
 */
export async function setDayAction(formData: FormData): Promise<void> {
  const { person } = await requireOnboarded();
  const date = field(formData, 'date');
  if (!isValidDate(date)) redirect('/');

  const want = field(formData, 'want') === 'yes';
  const deps = dayDeps();
  const outcome = want
    ? await wantLunch(deps, person, {
        date,
        officeId: field(formData, 'officeId') || person.officeId!,
        slot: field(formData, 'slot') || null,
      })
    : await dropLunch(deps, person, date);

  revalidatePath('/');
  back(date, outcome);
}

/** "Every Tuesday and Thursday." An empty set stops it. */
export async function savePatternAction(formData: FormData): Promise<void> {
  const { person } = await requireOnboarded();
  const weekdays = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter(
    (d) => formData.get(`day${d}`) === 'on',
  );
  await setPattern(getDb(), {
    employeeId: person.id,
    weekdays,
    slot: field(formData, 'slot') || null,
  });
  revalidatePath('/');
  redirect('/?note=pattern');
}

/** A reply to a table, for your own seat at your own table only. */
export async function respondAction(formData: FormData): Promise<void> {
  const { person } = await requireOnboarded();
  const tableId = field(formData, 'tableId');
  const status: RsvpStatus = field(formData, 'status') === 'declined' ? 'declined' : 'accepted';

  const outcome = await respond(dayDeps(), person, tableId, status);
  revalidatePath('/');
  redirect(
    `/c/${encodeURIComponent(tableId)}?note=${encodeURIComponent(outcome.ok ? status : outcome.reason)}`,
  );
}
