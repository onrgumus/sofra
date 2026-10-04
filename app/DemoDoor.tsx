'use client';

import { useFormStatus } from 'react-dom';
import { enterDemoAction } from './actions/auth';

function EnterButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" data-variant="primary" disabled={pending}>
      {pending ? 'Laying your table…' : 'Try the demo'}
    </button>
  );
}

/**
 * The public demo's door. One press: no address, no password. Walking in can
 * take a moment, because the visitor's table is made on the way.
 */
export function DemoDoor() {
  return (
    <form action={enterDemoAction} className="card stack" style={{ maxWidth: 420 }}>
      <EnterButton />
      <p className="faint">
        No sign-up. You walk in as an invented colleague at an invented company, already seated at a
        lunch table. Nothing here is real, and it is all reset regularly.
      </p>
    </form>
  );
}
