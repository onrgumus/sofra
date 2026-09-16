'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A select that submits its form on change, so the demo needs no Apply button.
 * The only client component in the app; everything else renders on the server.
 */
export function AutoSubmitSelect(props: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  'aria-label': string;
}) {
  const ref = useRef<HTMLSelectElement>(null);

  return (
    <select
      ref={ref}
      // Keyed on the value so a server-driven change remounts the select with
      // the right name. Without it the header can show a different person than
      // the one the server is acting as, which in this app is genuinely unsafe.
      key={props.defaultValue}
      name={props.name}
      defaultValue={props.defaultValue}
      aria-label={props['aria-label']}
      onChange={() => ref.current?.form?.requestSubmit()}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A checkbox that saves the moment it changes.
 *
 * Submitting re-renders the page from the server, which drops focus to the
 * body: someone using the keyboard ticks a day and lands back at the top of the
 * document with no idea whether anything happened. So the checkbox remembers
 * that it submitted and takes focus back, and says what changed in a live
 * region for anyone who cannot see the tick.
 */
export function AutoSubmitCheckbox(props: {
  name: string;
  defaultChecked: boolean;
  label: string;
  title?: string;
  /** Tells one day's checkbox from another's when focus is restored. */
  focusKey: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (sessionStorage.getItem(FOCUS_KEY) !== props.focusKey) return;
    sessionStorage.removeItem(FOCUS_KEY);
    ref.current?.focus();
  }, [props.focusKey, props.defaultChecked]);

  return (
    <label className="check" title={props.title}>
      <input
        ref={ref}
        key={String(props.defaultChecked)}
        type="checkbox"
        name={props.name}
        defaultChecked={props.defaultChecked}
        onChange={(event) => {
          sessionStorage.setItem(FOCUS_KEY, props.focusKey);
          setAnnouncement(event.target.checked ? `${props.label}: yes` : `${props.label}: no`);
          ref.current?.form?.requestSubmit();
        }}
      />
      {props.label}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </label>
  );
}

const FOCUS_KEY = 'sofra:restore-focus';
