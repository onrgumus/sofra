'use client';

import { useActionState } from 'react';
import { saveOfficeAction, type OfficeFormState } from '../actions/admin';

export interface OfficeFormValues {
  id: string;
  name: string;
  address: string;
  meetingPoint: string;
  timeZone: string;
  opensAt: string;
  matchLeadMinutes: number;
  confirmBy: string;
  reminderAt: string;
  lunchSlots: string;
  workingDays: number[];
  minTable: number;
  maxTable: number;
  locationKeywords: string;
  active: boolean;
}

const LEADS = [30, 60, 90, 120, 150, 180, 210, 240, 300, 360, 480, 600, 720];
const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

function leadLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** Creating and editing an office: one form, every error beside its field. */
export function OfficeForm({
  initial,
  existingId,
  timeZones,
}: {
  initial: OfficeFormValues;
  existingId?: string;
  timeZones: string[];
}) {
  const [state, action, pending] = useActionState<OfficeFormState, FormData>(saveOfficeAction, {
    errors: {},
    values: {},
  });
  const value = (key: keyof OfficeFormValues): string =>
    state.values[key] ?? String(initial[key] ?? '');
  const checked = (key: string, fallback: boolean) =>
    Object.keys(state.values).length > 0 ? state.values[key] === 'on' : fallback;
  const error = (key: string) =>
    state.errors[key] ? <span className="field-error">{state.errors[key]}</span> : null;

  return (
    <form action={action} className="card form-grid" noValidate>
      {existingId ? <input type="hidden" name="existingId" value={existingId} /> : null}

      {existingId ? null : (
        <label className="field">
          <span>Short id</span>
          <input name="id" defaultValue={value('id')} placeholder="IST-HQ" required />
          <span className="faint">Fixed once created. Letters, digits, dashes.</span>
          {error('id')}
        </label>
      )}

      <label className="field">
        <span>Name</span>
        <input name="name" defaultValue={value('name')} placeholder="Istanbul HQ" required />
        {error('name')}
      </label>

      <label className="field">
        <span>Address</span>
        <input name="address" defaultValue={value('address')} />
      </label>

      <label className="field">
        <span>Where tables meet</span>
        <input
          name="meetingPoint"
          defaultValue={value('meetingPoint')}
          placeholder="Ground floor cafeteria"
        />
      </label>

      <label className="field">
        <span>Time zone</span>
        <input name="timeZone" defaultValue={value('timeZone')} list="time-zones" required />
        <datalist id="time-zones">
          {timeZones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <span className="faint">
          A place name, like Europe/Istanbul, so clock changes are right.
        </span>
        {error('timeZone')}
      </label>

      <label className="field">
        <span>Office opens</span>
        <input type="time" name="opensAt" defaultValue={value('opensAt')} required />
        {error('opensAt')}
      </label>

      <label className="field">
        <span>Make the tables</span>
        <select name="matchLeadMinutes" defaultValue={value('matchLeadMinutes')}>
          {LEADS.map((m) => (
            <option key={m} value={m}>
              {leadLabel(m)} before opening
            </option>
          ))}
        </select>
        {error('matchLeadMinutes')}
      </label>

      <label className="field">
        <span>Replies close</span>
        <input type="time" name="confirmBy" defaultValue={value('confirmBy')} required />
        <span className="faint">After this, nobody is moved between tables.</span>
        {error('confirmBy')}
      </label>

      <label className="field">
        <span>Evening question, the day before</span>
        <input type="time" name="reminderAt" defaultValue={value('reminderAt')} required />
        {error('reminderAt')}
      </label>

      <label className="field">
        <span>Lunch times</span>
        <input
          name="lunchSlots"
          defaultValue={value('lunchSlots')}
          placeholder="12:00, 13:00"
          required
        />
        {error('lunchSlots')}
      </label>

      <fieldset className="field span-2">
        <legend>Working days</legend>
        <div className="checks">
          {DAYS.map(([day, label]) => (
            <label key={day} className="check">
              <input
                type="checkbox"
                name={`day${day}`}
                defaultChecked={checked(`day${day}`, initial.workingDays.includes(day))}
              />
              {label}
            </label>
          ))}
        </div>
        {error('workingDays')}
      </fieldset>

      <label className="field">
        <span>Smallest table</span>
        <input type="number" name="minTable" min={2} max={8} defaultValue={value('minTable')} />
        {error('minTable')}
      </label>

      <label className="field">
        <span>Largest table</span>
        <input type="number" name="maxTable" min={2} max={8} defaultValue={value('maxTable')} />
        {error('maxTable')}
      </label>

      <label className="field span-2">
        <span>Words that mean this office in Entra or Outlook</span>
        <input
          name="locationKeywords"
          defaultValue={value('locationKeywords')}
          placeholder="istanbul, maslak"
        />
        <span className="faint">
          Used to recognise this office in directory records and calendar entries.
        </span>
      </label>

      <label className="check field">
        <input type="checkbox" name="active" defaultChecked={checked('active', initial.active)} />
        Taking lunches
      </label>

      {state.errors['timetable'] ? (
        <p className="error-text span-2" role="alert">
          {state.errors['timetable']}
        </p>
      ) : null}
      {state.errors['form'] ? (
        <p className="error-text span-2" role="alert">
          {state.errors['form']}
        </p>
      ) : null}

      <div className="span-2">
        <button type="submit" data-variant="primary" disabled={pending}>
          {pending ? 'Saving…' : existingId ? 'Save office' : 'Create office'}
        </button>
      </div>
    </form>
  );
}
