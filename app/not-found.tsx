import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <div className="page-head">
        <h1>Nothing here</h1>
        <p>
          That page does not exist. If you followed a link from an invite, the table may have been
          re-matched — your current one is always on your lunches page.
        </p>
      </div>
      <Link className="button" href="/">
        Back to your lunches
      </Link>
    </main>
  );
}
