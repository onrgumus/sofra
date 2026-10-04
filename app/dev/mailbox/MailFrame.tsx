'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * A mail's own HTML, as a mail client shows it, as tall as the mail.
 *
 * Nothing inside runs: no scripts are allowed, so letting this page read the
 * frame's height (same origin) gives the mail no way to reach the page. A link
 * in it opens in this tab, as it would from the inbox.
 */
export function MailFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);

  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (frame.current && doc?.documentElement) {
      frame.current.style.height = `${doc.documentElement.scrollHeight + 2}px`;
    }
  }, []);

  useEffect(() => {
    // The frame may have loaded before this page came alive and heard it.
    if (frame.current?.contentDocument?.readyState === 'complete') fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  return (
    <iframe
      ref={frame}
      title="The mail as it arrives"
      className="mail-frame"
      sandbox="allow-same-origin allow-top-navigation-by-user-activation"
      srcDoc={`<base target="_top"><style>body{margin:16px}</style>${html}`}
      onLoad={fit}
    />
  );
}
