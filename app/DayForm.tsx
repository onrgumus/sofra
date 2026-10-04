'use client';

import { useState } from 'react';
import { setDayAction } from './actions/lunch';

export interface DayFormOffice {
  id: string;
  name: string;
  slots: string[];
}

/**
 * Asking for lunch on one day. The times on offer follow the office picked:
 * an office with one lunch time offers no choice, and a time another office
 * has is never offered for this one.
 */
export function DayForm({
  date,
  homeId,
  offices,
  label,
}: {
  date: string;
  homeId: string;
  offices: DayFormOffice[];
  label: string;
}) {
  const [officeId, setOfficeId] = useState(homeId);
  const office = offices.find((o) => o.id === officeId) ?? offices[0];
  const slots = office?.slots ?? [];

  return (
    <form action={setDayAction} className="inline day-form">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="want" value="yes" />
      {offices.length > 1 ? (
        <select
          name="officeId"
          value={officeId}
          onChange={(e) => setOfficeId(e.target.value)}
          aria-label="Office that day"
        >
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="officeId" value={officeId} />
      )}
      {slots.length > 1 ? (
        // Keyed by office, so a time picked for one office never carries over to another.
        <select key={officeId} name="slot" defaultValue="" aria-label="Lunch time">
          <option value="">Any time</option>
          {slots.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : null}
      <button type="submit" data-variant="primary">
        {label}
      </button>
    </form>
  );
}
