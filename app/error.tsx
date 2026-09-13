'use client';

/**
 * Next.js gives every server action an id that changes when the app is rebuilt,
 * so a tab left open across a deploy calls an id the server no longer has. It is
 * the one error here that a reload genuinely fixes and `reset()` genuinely does
 * not, because re-rendering keeps the stale ids.
 */
function isStaleBuild(error: Error): boolean {
  return /server action|was not found on the server/i.test(error.message);
}

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const stale = isStaleBuild(error);

  return (
    <main>
      <div className="page-head">
        <h1>{stale ? 'This page is out of date' : 'Something went wrong'}</h1>
        <p>
          {stale
            ? 'Sofra was updated while you had this open, so the button you pressed no longer exists. Reloading picks up the new version, and nothing you did was lost.'
            : 'Sofra could not render this page. Your lunches are unaffected: nothing is sent or cancelled by a page failing to load.'}
        </p>
      </div>

      <div className="row">
        {stale ? (
          <button type="button" data-variant="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        ) : (
          <button type="button" data-variant="primary" onClick={reset}>
            Try again
          </button>
        )}
        <a className="button" href="/">
          Back to your lunches
        </a>
      </div>

      {error.digest ? (
        <p className="faint" style={{ marginTop: 16 }}>
          Reference: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
