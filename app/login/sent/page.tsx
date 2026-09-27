import Link from 'next/link';
import { mailboxEnabled } from '../../../src/services/mail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Check your email · Sofra' };

/**
 * The same page whether or not a link actually went, so the form cannot be
 * used to find out who can sign in.
 */
export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const devMailbox = mailboxEnabled() && process.env.NODE_ENV !== 'production';

  return (
    <main className="signin">
      <div className="page-head">
        <h1>Check your email</h1>
        <p>
          If {email ? <strong>{email}</strong> : 'that address'} can use Sofra, a sign-in link is on
          its way. It works once, for fifteen minutes, on any device.
        </p>
      </div>
      <div className="stack" style={{ maxWidth: 420 }}>
        {devMailbox ? (
          <a
            className="button"
            data-variant="primary"
            href={`/dev/mailbox${email ? `?to=${encodeURIComponent(email)}` : ''}`}
          >
            Open the development mailbox
          </a>
        ) : null}
        <p className="faint">
          Nothing arrived? Check the spam folder, and that the address is your work one.{' '}
          <Link href="/login">Try again</Link>.
        </p>
      </div>
    </main>
  );
}
