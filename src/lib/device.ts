/**
 * A browser's user agent as somebody recognises their own device: "Chrome on
 * macOS", "Teams on Windows". Order matters, since nearly every browser also
 * calls itself Safari and Chrome-based ones call themselves Chrome.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'Unknown device';

  const app = /Teams\//.test(ua)
    ? 'Teams'
    : /Edg(e|A|iOS)?\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;

  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  if (app && system) return `${app} on ${system}`;
  return app ?? system ?? 'Unknown device';
}
