'use client';

import { useRef } from 'react';

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

/** A checkbox that saves immediately, used for the balanced-group preference. */
export function AutoSubmitCheckbox(props: {
  name: string;
  defaultChecked: boolean;
  label: string;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <label className="check" title={props.title}>
      <input
        ref={ref}
        key={String(props.defaultChecked)}
        type="checkbox"
        name={props.name}
        defaultChecked={props.defaultChecked}
        onChange={() => ref.current?.form?.requestSubmit()}
      />
      {props.label}
    </label>
  );
}
