import { SENIORITY_LADDER } from '../src/core/types';
import type { Queryable } from '../src/db';
import { listOffices } from '../src/data/offices';
import { listDepartments } from '../src/data/settings';
import type { Person } from '../src/data/types';
import { LANGUAGES, SENIORITY_LABELS } from '../src/services/forms';
import type { ProfileFormProps } from './ProfileForm';

/** Everything the profile form needs, filled from what is known about the person. */
export async function profileFormProps(
  db: Queryable,
  person: Person,
  submitLabel: string,
): Promise<ProfileFormProps> {
  const offices = await listOffices(db, { activeOnly: true });
  return {
    initial: {
      displayName: person.displayName,
      title: person.title,
      department: person.department ?? '',
      team: person.team.startsWith('manager:') ? '' : person.team,
      seniority: person.seniority ?? '',
      officeId: person.officeId ?? (offices.length === 1 ? offices[0]!.id : ''),
      languages: person.languages,
      interests: person.interests.join(', '),
      startedOn: person.startedOn?.slice(0, 7) ?? '',
      reminders: person.reminders,
    },
    departments: await listDepartments(db),
    offices: offices.map((o) => ({ id: o.id, name: o.name })),
    languages: [...LANGUAGES],
    seniorities: SENIORITY_LADDER.map((s) => ({ value: s, label: SENIORITY_LABELS[s] })),
    submitLabel,
  };
}
