/**
 * Reading configuration, where blank means absent.
 *
 * `process.env.X ?? fallback` only falls back on undefined, and every hosting
 * dashboard lets you save a variable with an empty value: paste a template,
 * leave the ones you have not filled in yet, deploy. The variable then exists,
 * is the empty string, and silently beats the default.
 *
 * That shipped. A deployment had SOFRA_DEMO_PASSWORD set to nothing, so the
 * sign-in page advertised "onur / " and no password on earth would work.
 */
export function envText(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : fallback;
}

/** Same rule, and a value that is not a number falls back rather than becoming NaN. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Present and non-blank, or undefined. For the ones with no sensible default. */
export function envOptional(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : undefined;
}
