import { redirect } from 'next/navigation';
import { requirePerson } from '../../src/auth/session';
import { getDb } from '../../src/db';
import { listOffices } from '../../src/data/offices';
import { listDepartments } from '../../src/data/settings';
import { ProfileForm } from '../ProfileForm';
import { profileFormProps } from '../profile-props';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome · Sofra' };

/**
 * The first thing somebody sees after signing in for the first time. Nobody is
 * seated before they have said where they work and what they do, because those
 * are what a table is made of.
 */
export default async function WelcomePage() {
  const { person } = await requirePerson();
  if (person.onboardedAt) redirect('/');

  const db = getDb();
  const [offices, departments] = await Promise.all([
    listOffices(db, { activeOnly: true }),
    listDepartments(db),
  ]);

  return (
    <main>
      <div className="page-head">
        <h1>Welcome{person.displayName ? `, ${person.displayName.split(' ')[0]}` : ''}</h1>
        <p>
          A few answers and you are ready. Sofra seats you with colleagues from other departments
          and levels, so it needs to know yours. The people at your table see your name, title and
          department; the admins who run Sofra can see your profile, and nobody else can.
        </p>
      </div>

      {offices.length === 0 || departments.length === 0 ? (
        <div className="note">
          Sofra has not been set up here yet: an admin still has to add{' '}
          {offices.length === 0 ? 'the offices' : 'the departments'}. Come back once they have.
        </div>
      ) : (
        <ProfileForm {...await profileFormProps(db, person, 'Save and continue')} />
      )}
    </main>
  );
}
