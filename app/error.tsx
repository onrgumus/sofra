'use client';

/**
 * Nothing here should ever be reachable, but a blank screen is the worst way to
 * find that out. Says what happened and offers the one action that helps.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <div className="page-head">
        <h1>Something went wrong</h1>
        <p>
          Sofra could not render this page. Your lunches are unaffected — nothing is sent or
          cancelled by a page failing to load.
        </p>
      </div>
      <div className="row">
        <button type="button" data-variant="primary" onClick={reset}>
          Try again
        </button>
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
