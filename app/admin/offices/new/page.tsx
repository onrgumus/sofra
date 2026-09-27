import { requireAdmin } from '../../../../src/auth/session';
import { timeZones } from '../../../../src/lib/zoned';
import { OfficeForm } from '../../OfficeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New office · Sofra' };

export default async function NewOfficePage() {
  await requireAdmin({ everyOffice: true });
  return (
    <main>
      <div className="page-head">
        <h1>New office</h1>
        <p>
          Tables are made before the office opens, so the invite is waiting for people when they
          arrive. Everything here can be changed later except the id.
        </p>
      </div>
      <OfficeForm
        timeZones={timeZones()}
        initial={{
          id: '',
          name: '',
          address: '',
          meetingPoint: '',
          timeZone: 'Europe/Istanbul',
          opensAt: '09:00',
          matchLeadMinutes: 180,
          confirmBy: '10:00',
          reminderAt: '16:00',
          lunchSlots: '12:00',
          workingDays: [1, 2, 3, 4, 5],
          minTable: 3,
          maxTable: 4,
          locationKeywords: '',
          active: true,
        }}
      />
    </main>
  );
}
