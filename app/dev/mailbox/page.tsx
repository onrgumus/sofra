import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '../../../src/db';
import { getMail, listMail } from '../../../src/data/messages';
import { mailboxEnabled } from '../../../src/services/mail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mailbox · Sofra (development)' };

/**
 * Mail the outbox transport kept instead of sending. Only in development:
 * anybody who can open it can read every sign-in link, so a production build
 * does not have it at all.
 */
export default async function MailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; id?: string }>;
}) {
  if (process.env.NODE_ENV === 'production' || !mailboxEnabled()) notFound();

  const { to, id } = await searchParams;
  const db = getDb();

  if (id) {
    const mail = await getMail(db, Number(id));
    if (!mail) notFound();
    return (
      <main>
        <p>
          <Link href={`/dev/mailbox${to ? `?to=${encodeURIComponent(to)}` : ''}`}>← Mailbox</Link>
        </p>
        <div className="page-head">
          <h1>{mail.subject}</h1>
          <p className="faint">
            To {mail.recipients.join(', ')} · {mail.createdAt.slice(0, 19).replace('T', ' ')} UTC
          </p>
        </div>
        <article className="card invite">{linkify(mail.text)}</article>
        {mail.attachments.length > 0 ? (
          <details className="card">
            <summary>Attachments ({mail.attachments.map((a) => a.filename).join(', ')})</summary>
            {mail.attachments.map((a) => (
              <pre key={a.filename} className="mono small">
                {a.content}
              </pre>
            ))}
          </details>
        ) : null}
      </main>
    );
  }

  const mails = await listMail(db, { recipient: to, limit: 100 });
  return (
    <main>
      <div className="page-head">
        <h1>Development mailbox</h1>
        <p>
          Mail is kept here instead of being sent, because SOFRA_MAIL_TRANSPORT is outbox.
          {to ? (
            <>
              {' '}
              Showing mail to <strong>{to}</strong>. <Link href="/dev/mailbox">Show all</Link>
            </>
          ) : null}
        </p>
      </div>
      <form method="get" className="inline">
        <input name="to" defaultValue={to ?? ''} placeholder="address" aria-label="Recipient" />
        <button type="submit">Filter</button>
      </form>
      <div className="card" style={{ marginTop: 12 }}>
        <table className="data">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>To</th>
              <th>Subject</th>
            </tr>
          </thead>
          <tbody>
            {mails.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.createdAt.slice(5, 16).replace('T', ' ')}</td>
                <td className="truncate">{m.recipients.join(', ')}</td>
                <td>
                  <Link
                    href={`/dev/mailbox?id=${m.id}${to ? `&to=${encodeURIComponent(to)}` : ''}`}
                  >
                    {m.subject}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {mails.length === 0 ? <p className="faint">No mail yet.</p> : null}
      </div>
    </main>
  );
}

/** Plain text with its links made clickable, and nothing else interpreted. */
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part}>
        {part}
      </a>
    ) : (
      part
    ),
  );
}
