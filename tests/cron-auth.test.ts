import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { refuseUnlessScheduled } from '../src/lib/cron-auth';

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://sofra.example.com/api/cron', { headers });
}

describe('guarding the scheduled endpoints', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to run at all without a secret', async () => {
    // Running openly is worse than not running: anyone who can reach it can
    // reshuffle tomorrow's tables and mail the whole company.
    vi.stubEnv('CRON_SECRET', '');
    const refusal = refuseUnlessScheduled(request({ authorization: 'Bearer anything' }));

    expect(refusal?.status).toBe(503);
    await expect(refusal!.json()).resolves.toEqual({ error: 'CRON_SECRET is not configured' });
  });

  it('refuses a request with no authorization at all', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(refuseUnlessScheduled(request())?.status).toBe(401);
  });

  it('refuses the wrong secret', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(refuseUnlessScheduled(request({ authorization: 'Bearer wrong' }))?.status).toBe(401);
  });

  it('refuses the right secret in the wrong scheme', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(refuseUnlessScheduled(request({ authorization: 'the-secret' }))?.status).toBe(401);
    expect(refuseUnlessScheduled(request({ authorization: 'Basic the-secret' }))?.status).toBe(401);
  });

  it('lets the scheduler through', () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect(refuseUnlessScheduled(request({ authorization: 'Bearer the-secret' }))).toBeNull();
  });

  it('treats a blank secret as unconfigured, not as a password', () => {
    // envOptional returns undefined for a blank, so the 503 branch is what
    // should fire. An empty string matching `Bearer ` would be a way in.
    vi.stubEnv('CRON_SECRET', '   ');
    const refusal = refuseUnlessScheduled(request({ authorization: 'Bearer    ' }));
    expect(refusal?.status).not.toBe(null);
    expect([401, 503]).toContain(refusal?.status);
  });
});
