export interface SignInMail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The sign-in link. Short, says where it came from and how long it lasts, and
 * what to do if you did not ask for it, which is the one thing a phished
 * person needs to read.
 */
export function buildSignInMail(options: {
  url: string;
  minutes: number;
  companyName: string;
}): SignInMail {
  const { url, minutes, companyName } = options;
  const text = [
    `Sign in to Sofra at ${companyName}:`,
    '',
    url,
    '',
    `The link works once, for ${minutes} minutes, on any device.`,
    'If you did not ask to sign in, ignore this mail. Nobody can use the link without it.',
    '',
    `Sofra'ya giriş bağlantın ${minutes} dakika geçerli ve tek kullanımlık. Sen istemediysen bu maili yok say.`,
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55">',
    `<p>Sign in to Sofra at ${escapeHtml(companyName)}:</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#b4531f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Sign in</a></p>`,
    `<p>The link works once, for ${minutes} minutes, on any device.<br>If you did not ask to sign in, ignore this mail. Nobody can use the link without it.</p>`,
    `<p style="color:#6b6258">Sofra'ya giriş bağlantın ${minutes} dakika geçerli ve tek kullanımlık. Sen istemediysen bu maili yok say.</p>`,
    `<p style="color:#6b6258;font-size:13px">${escapeHtml(url)}</p>`,
    '</div>',
  ].join('');

  return { subject: 'Your Sofra sign-in link', text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
