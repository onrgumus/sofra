'use client';

import { useActionState } from 'react';
import { saveProfileAction, type ProfileFormState } from './actions/profile';

export interface ProfileFormProps {
  initial: {
    displayName: string;
    title: string;
    department: string;
    team: string;
    seniority: string;
    officeId: string;
    languages: string[];
    interests: string;
    startedOn: string;
    reminders: boolean;
  };
  departments: string[];
  offices: { id: string; name: string }[];
  languages: { code: string; name: string }[];
  seniorities: { value: string; label: string }[];
  submitLabel: string;
}

/**
 * The one form for what somebody says about themselves, on the welcome page
 * and their own page. Errors come back beside the field they are about, with
 * everything typed still in place.
 */
export function ProfileForm(props: ProfileFormProps) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfileAction, {
    errors: {},
    values: {},
  });
  const v = (key: keyof ProfileFormProps['initial'], fallback: string) =>
    state.values[key] ?? fallback;
  const chosenLanguages = state.values['languages']
    ? state.values['languages'].split(',')
    : props.initial.languages;
  const error = (key: string) =>
    state.errors[key] ? (
      <span className="field-error" id={`${key}-error`}>
        {state.errors[key]}
      </span>
    ) : null;

  return (
    // Keyed by what came back, so a form returned with errors is built afresh
    // from those values. React resets a form after its action, and a select
    // left in place would go back to the value it was first drawn with.
    <form key={JSON.stringify(state.values)} action={action} className="card form-grid" noValidate>
      <label className="field">
        <span>Your name</span>
        <input
          name="displayName"
          defaultValue={v('displayName', props.initial.displayName)}
          autoComplete="name"
          required
          aria-invalid={Boolean(state.errors['displayName'])}
        />
        {error('displayName')}
      </label>

      <label className="field">
        <span>Job title</span>
        <input
          name="title"
          defaultValue={v('title', props.initial.title)}
          autoComplete="organization-title"
        />
      </label>

      <label className="field">
        <span>Department</span>
        <select
          name="department"
          defaultValue={v('department', props.initial.department)}
          aria-invalid={Boolean(state.errors['department'])}
        >
          <option value="">Choose…</option>
          {props.departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {error('department')}
      </label>

      <label className="field">
        <span>Team</span>
        <input
          name="team"
          defaultValue={v('team', props.initial.team)}
          placeholder="e.g. Payments"
        />
        <span className="faint">You will not be seated with people from your own team.</span>
      </label>

      <label className="field">
        <span>Level</span>
        <select
          name="seniority"
          defaultValue={v('seniority', props.initial.seniority)}
          aria-invalid={Boolean(state.errors['seniority'])}
        >
          <option value="">Choose…</option>
          {props.seniorities.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {error('seniority')}
      </label>

      <label className="field">
        <span>Office you usually work in</span>
        <select
          name="officeId"
          defaultValue={v('officeId', props.initial.officeId)}
          aria-invalid={Boolean(state.errors['officeId'])}
        >
          <option value="">Choose…</option>
          {props.offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {error('officeId')}
      </label>

      <fieldset className="field span-2">
        <legend>Languages you are happy to have lunch in</legend>
        <div className="checks">
          {props.languages.map((l) => (
            <label key={l.code} className="check">
              <input
                type="checkbox"
                name="languages"
                value={l.code}
                defaultChecked={chosenLanguages.includes(l.code)}
              />
              {l.name}
            </label>
          ))}
        </div>
        {error('languages')}
      </fieldset>

      <label className="field span-2">
        <span>Interests</span>
        <input
          name="interests"
          defaultValue={v('interests', props.initial.interests)}
          placeholder="cycling, chess, live music"
        />
        <span className="faint">Comma separated. A shared one is how the conversation starts.</span>
      </label>

      <label className="field">
        <span>Started here (optional)</span>
        <input
          type="month"
          name="startedOn"
          defaultValue={v('startedOn', props.initial.startedOn)}
        />
        {error('startedOn')}
      </label>

      <label className="check field">
        <input
          type="checkbox"
          name="reminders"
          defaultChecked={state.values['reminders'] ? true : props.initial.reminders}
        />
        Ask me the evening before, on days I am likely to be in
      </label>

      <div className="span-2 row">
        <button type="submit" data-variant="primary" disabled={pending}>
          {pending ? 'Saving…' : props.submitLabel}
        </button>
        {Object.keys(state.errors).length > 0 ? (
          <span className="error-text" role="alert">
            Some answers need another look.
          </span>
        ) : null}
      </div>
    </form>
  );
}
