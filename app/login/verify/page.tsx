import Link from 'next/link';
import { describeLink } from '../../../src/auth/signin';
import { getDb } from '../../../src/db';
import { confirmLinkAction } from '../../actions/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Sofra' };

/**
 * Where the emailed link lands. It asks for one press instead of signing in
 * straight away, because corporate mail scanners open every link in incoming
 * mail to check it; a link that signed in on sight would be used up by the
 * scanner before the person ever clicked it.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  const pending = await describeLink(getDb(), token);

  if (!pending) {
    return (
      <main className="signin">
        <div className="page-head">
          <h1>That link has expired</h1>
          <p>Sign-in links work once, for fifteen minutes. Ask for a new one.</p>
        </div>
        <Link className="button" data-variant="primary" href="/login">
          Get a new link
        </Link>
      </main>
    );
  }

  return (
    <main className="signin">
      <div className="page-head">
        <h1>Sign in to Sofra</h1>
        <p>
          as <strong>{pending.email}</strong>
        </p>
      </div>
      <form action={confirmLinkAction} className="card stack" style={{ maxWidth: 420 }}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" data-variant="primary">
          Sign in
        </button>
        <p className="faint">
          Not you? Close this page; nothing happens unless you press the button.
        </p>
      </form>
    </main>
  );
}
