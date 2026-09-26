import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, person, seedBasics, type TestDb } from './support/db';
import { RecordingChannel } from './support/channel';
import { verifyBotRequest } from '../src/teams/auth';
import { handleActivity, type Activity } from '../src/teams/handler';
import { TeamsBotChannel } from '../src/teams/channel';
import { createConnector, type Connector } from '../src/teams/connector';
import { trustedServiceUrl } from '../src/teams/config';
import { getTeamsConversation, saveTeamsConversation } from '../src/data/messages';
import { getRequest, setRequest } from '../src/data/lunch';
import { getOffice } from '../src/data/offices';
import { linkEntra } from '../src/data/people';
import { listTables } from '../src/data/tables';
import { planOfficeDay } from '../src/services/planning';
import { getDb } from '../src/db';
import type { Person } from '../src/data/types';

const APP_ID = 'bot-app-id';
const SERVICE = 'https://smba.trafficmanager.net/emea/';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'bf-1', alg: 'RS256', use: 'sig' };
const jwks = (async () =>
  ({
    ok: true,
    json: async () => ({ keys: [jwk] }),
  }) as unknown as Response) as unknown as typeof fetch;

function botToken(claims: Record<string, unknown> = {}, key = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'bf-1', typ: 'JWT' });
  const body = enc({
    iss: 'https://api.botframework.com',
    aud: APP_ID,
    serviceurl: SERVICE,
    exp: now + 600,
    nbf: now - 10,
    ...claims,
  });
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(key).toString('base64url')}`;
}

let jwksCounter = 0;
const verify = (token: string, serviceUrl = SERVICE) =>
  verifyBotRequest(`Bearer ${token}`, {
    appId: APP_ID,
    serviceUrl,
    fetchImpl: jwks,
    // A key set of its own per call, so the cache from one case never answers another.
    jwksUri: `https://keys.test/${++jwksCounter}`,
  });

describe('who may talk to the bot', () => {
  it('accepts the Bot Framework, signed, for this bot and this conversation', async () => {
    await expect(verify(botToken())).resolves.toBeUndefined();
  });

  it('refuses a forgery, another bot, another issuer, another service, an old token', async () => {
    await expect(verify(botToken({}, stranger.privateKey))).rejects.toThrow();
    await expect(verify(botToken({ aud: 'someone-else' }))).rejects.toThrow(/another bot/);
    await expect(verify(botToken({ iss: 'https://evil.example' }))).rejects.toThrow(
      /Bot Framework/,
    );
    await expect(verify(botToken(), 'https://smba.trafficmanager.net/amer/')).rejects.toThrow(
      /service URL/,
    );
    await expect(verify(botToken({ exp: Math.floor(Date.now() / 1000) - 3600 }))).rejects.toThrow(
      /expired/,
    );
    await expect(verifyBotRequest(null, { appId: APP_ID, serviceUrl: SERVICE })).rejects.toThrow(
      /bearer/,
    );
  });

  it('only ever sends a token to Microsoft', () => {
    expect(trustedServiceUrl(SERVICE)).toBe(true);
    expect(trustedServiceUrl('https://smba.infra.teams.microsoft.com/x')).toBe(true);
    expect(trustedServiceUrl('https://evil.example/')).toBe(false);
    expect(trustedServiceUrl('http://smba.trafficmanager.net/')).toBe(false);
    expect(trustedServiceUrl('https://smba.trafficmanager.net.evil.example/')).toBe(false);
  });
});

class FakeConnector implements Connector {
  sent: { serviceUrl: string; conversationId: string; activity: Record<string, unknown> }[] = [];
  async send(serviceUrl: string, conversationId: string, activity: Record<string, unknown>) {
    this.sent.push({ serviceUrl, conversationId, activity });
  }
}

let t: TestDb;
const people: Person[] = [];
const connector = new FakeConnector();
const channel = new RecordingChannel();

beforeAll(async () => {
  t = await createTestDb();
  await seedBasics(t.db);
  for (let i = 0; i < 4; i++) {
    const p = await person(t.db, i);
    await linkEntra(t.db, p.id, `oid-${i}`);
    people.push({ ...p, entraObjectId: `oid-${i}` });
  }
});
afterAll(async () => t.cleanup());
beforeEach(() => {
  connector.sent = [];
  channel.clear();
});

function deps(now = new Date()) {
  return {
    db: t.db,
    connector,
    channel,
    from: 'sofra@acme.test',
    now: () => now,
    baseUrl: 'https://sofra.acme.test',
  };
}

function activity(overrides: Partial<Activity> & { oid?: string }): Activity {
  const { oid = 'oid-0', ...rest } = overrides;
  return {
    type: 'message',
    serviceUrl: SERVICE,
    from: { id: '29:user', aadObjectId: oid, name: 'Person' },
    conversation: { id: `a:conv-${oid}`, conversationType: 'personal', tenantId: 'tenant' },
    ...rest,
  };
}

describe('the bot in somebody’s chat', () => {
  it('remembers where to reach a person when they install it, and says hello', async () => {
    const result = await handleActivity(
      deps(),
      activity({ type: 'installationUpdate', action: 'add' }),
    );
    expect(result.status).toBe(200);
    expect(await getTeamsConversation(t.db, people[0]!.id)).toMatchObject({
      conversationId: 'a:conv-oid-0',
      serviceUrl: SERVICE,
    });
    expect(connector.sent).toHaveLength(1);
  });

  it('never remembers a group chat as somebody’s own', async () => {
    await handleActivity(
      deps(),
      activity({ oid: 'oid-1', conversation: { id: '19:group', conversationType: 'groupChat' } }),
    );
    expect(await getTeamsConversation(t.db, people[1]!.id)).toBeNull();
  });

  it('takes "count me in" from a card, as the person who clicked', async () => {
    const result = await handleActivity(
      deps(new Date('2026-10-01T10:00:00Z')),
      activity({
        type: 'invoke',
        name: 'adaptiveCard/action',
        value: { action: { verb: 'want', data: { date: '2026-10-05', officeId: 'IST' } } },
      }),
    );
    expect(result.body).toMatchObject({
      statusCode: 200,
      type: 'application/vnd.microsoft.card.adaptive',
    });
    expect(JSON.stringify(result.body)).toContain("You're in");
    expect(await getRequest(t.db, people[0]!.id, '2026-10-05')).toMatchObject({ source: 'teams' });
  });

  it('takes a reply to a table from its card, and shows the table as it now is', async () => {
    for (const p of people.slice(1, 4)) {
      await setRequest(t.db, {
        employeeId: p.id,
        date: '2026-10-05',
        officeId: 'IST',
        slot: null,
        source: 'manual',
      });
    }
    await planOfficeDay(getDb(), (await getOffice(t.db, 'IST'))!, '2026-10-05');
    const [table] = await listTables(t.db, 'IST', '2026-10-05');

    const result = await handleActivity(
      deps(new Date('2026-10-05T04:00:00Z')),
      activity({
        type: 'invoke',
        name: 'adaptiveCard/action',
        value: { action: { verb: 'rsvp', data: { tableId: table!.id, status: 'accepted' } } },
      }),
    );
    expect(JSON.stringify(result.body)).toContain("You're coming");
    expect((await listTables(t.db, 'IST', '2026-10-05'))[0]!.rsvps[people[0]!.id]).toBe('accepted');
  });

  it('asks somebody it does not know to set up first, and changes nothing', async () => {
    const result = await handleActivity(
      deps(),
      activity({
        oid: 'oid-unknown',
        type: 'invoke',
        name: 'adaptiveCard/action',
        value: { action: { verb: 'want', data: { date: '2026-10-06', officeId: 'IST' } } },
      }),
    );
    expect(JSON.stringify(result.body)).toContain('Set up Sofra first');
  });
});

describe('sending cards', () => {
  it('reaches the people who have the bot, and reports the rest', async () => {
    await saveTeamsConversation(t.db, {
      employeeId: people[2]!.id,
      conversationId: 'a:conv-2',
      serviceUrl: SERVICE,
      tenantId: 't',
    });
    const unreachable: string[] = [];
    const bot = new TeamsBotChannel({
      config: { appId: APP_ID, appPassword: 'x', tenantId: 't' },
      db: getDb,
      connector,
      onUnreachable: (e) => unreachable.push(e.id),
    });
    const [table] = await listTables(t.db, 'IST', '2026-10-05');
    await bot.sendInvite({
      groupId: table!.id,
      members: table!.members,
      invite: {
        subject: 'Lunch',
        text: 'x',
        html: 'x',
        ics: '',
        to: [],
        topic: '',
        confirmUrl: null,
      },
      details: {
        date: '2026-10-05',
        dayLabel: 'Mon 5 Oct',
        slot: '12:00',
        place: 'Cafe',
        rsvps: table!.rsvps,
        canReply: true,
      },
    });

    const reached = connector.sent.map((s) => s.conversationId).sort();
    expect(reached).toEqual(['a:conv-2', 'a:conv-oid-0'].sort());
    expect(unreachable.length).toBe(table!.members.length - 2);
    const card = JSON.stringify(connector.sent[0]!.activity);
    expect(card).toContain('Action.Execute');
    expect(card).toContain('rsvp');
  });

  it('will not send the bot’s token anywhere but Microsoft', async () => {
    const calls: string[] = [];
    const real = createConnector({ appId: APP_ID, appPassword: 'x', tenantId: 't' }, (async (
      url: string,
    ) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch);
    await expect(real.send('https://evil.example/', 'c', {})).rejects.toThrow(/Untrusted/);
    expect(calls).toEqual([]);
    await real.send(SERVICE, 'a:conv', { type: 'message' });
    expect(calls[1]).toBe(
      'https://smba.trafficmanager.net/emea/v3/conversations/a%3Aconv/activities',
    );
  });
});
