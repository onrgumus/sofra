import { describe, expect, it, vi } from 'vitest';
import { CompositeChannel, SlackChannel, TeamsChannel } from '../src/notify/channels';
import type { Delivery, InviteChannel } from '../src/notify/channels';
import { employee } from './helpers';

const members = [
  employee('a', { displayName: 'Ada Yılmaz', email: 'ada@example.com' }),
  employee('b', { displayName: 'Bruno Costa', email: 'bruno@example.com' }),
  employee('c', { displayName: 'Chloe Kaya', email: 'chloe@example.com' }),
  employee('d', { displayName: 'Deniz Novak', email: 'deniz@example.com' }),
];

const delivery: Delivery = {
  groupId: '2026-09-16-IST-HQ-12:00-1',
  members,
  invite: {
    subject: 'Lunch today at 12:00 — the four of you',
    text: 'The 4 of you are having lunch together.',
    html: '<p>x</p>',
    ics: 'BEGIN:VCALENDAR',
    to: members.map((m) => ({ name: m.displayName, email: m.email })),
    topic: 'What your team is actually measured on.',
    confirmUrl: 'https://sofra.example.com/c/abc',
  },
};

describe('SlackChannel', () => {
  function slack(overrides: Record<string, unknown> = {}) {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const method = String(url).split('/api/')[1]!;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ method, body });

      const responses: Record<string, unknown> = {
        'users.lookupByEmail': {
          ok: true,
          user: { id: `U-${String(body['email']).split('@')[0]}` },
        },
        'conversations.open': { ok: true, channel: { id: 'G123' } },
        'chat.postMessage': { ok: true },
        ...overrides,
      };
      return { json: async () => responses[method] } as unknown as Response;
    }) as unknown as typeof fetch;

    return { calls, channel: new SlackChannel({ token: 'xoxb-test', fetchImpl }) };
  }

  it('opens one group chat with everyone at the table, then posts into it', async () => {
    const { calls, channel } = slack();
    await channel.sendInvite(delivery);

    const open = calls.find((c) => c.method === 'conversations.open')!;
    expect(open.body['users']).toBe('U-ada,U-bruno,U-chloe,U-deniz');

    const post = calls.find((c) => c.method === 'chat.postMessage')!;
    expect(post.body['channel']).toBe('G123');
    expect(calls.filter((c) => c.method === 'conversations.open')).toHaveLength(1);
  });

  it('gives the chat a button to confirm or drop out', async () => {
    const { calls, channel } = slack();
    await channel.sendInvite(delivery);

    const blocks = JSON.stringify(
      calls.find((c) => c.method === 'chat.postMessage')!.body['blocks'],
    );
    expect(blocks).toContain('https://sofra.example.com/c/abc');
    expect(blocks).toContain('Confirm or drop out');
  });

  it('posts the cancellation into the same conversation', async () => {
    const { calls, channel } = slack();
    await channel.sendCancellation(delivery);

    expect(calls.find((c) => c.method === 'chat.postMessage')!.body['channel']).toBe('G123');
  });

  it('reports anyone without a Slack account instead of dropping them silently', async () => {
    const onUnreachable = vi.fn();
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const method = String(url).split('/api/')[1]!;
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      if (method === 'users.lookupByEmail') {
        return {
          json: async () =>
            body['email'] === 'chloe@example.com'
              ? { ok: true }
              : { ok: true, user: { id: `U-${body['email']}` } },
        } as unknown as Response;
      }
      if (method === 'conversations.open') {
        return { json: async () => ({ ok: true, channel: { id: 'G1' } }) } as unknown as Response;
      }
      return { json: async () => ({ ok: true }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await new SlackChannel({ token: 't', fetchImpl, onUnreachable }).sendInvite(delivery);
    expect(onUnreachable).toHaveBeenCalledTimes(1);
    expect(onUnreachable.mock.calls[0]![0].displayName).toBe('Chloe Kaya');
  });

  it('surfaces a Slack error rather than pretending it worked', async () => {
    // Slack answers 200 with ok:false, so the status alone proves nothing.
    const { channel } = slack({ 'conversations.open': { ok: false, error: 'restricted_action' } });
    await expect(channel.sendInvite(delivery)).rejects.toThrow(/restricted_action/);
  });
});

describe('TeamsChannel', () => {
  function teams() {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const graph = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return path === '/chats' ? { id: '19:chat-id' } : {};
    };
    return { calls, channel: new TeamsChannel({ graph, canSendMessages: true }) };
  }

  it('creates a group chat for the table and posts a card into it', async () => {
    const { calls, channel } = teams();
    await channel.sendInvite(delivery);

    const create = calls[0]!;
    expect(create.path).toBe('/chats');
    const created = create.body as { chatType: string; members: unknown[] };
    expect(created.chatType).toBe('group');
    expect(created.members).toHaveLength(4);

    expect(calls[1]!.path).toBe('/chats/19:chat-id/messages');
  });

  it('reuses the chat, so an updated invite does not spawn a second one', async () => {
    const { calls, channel } = teams();
    await channel.sendInvite(delivery);
    await channel.sendInvite(delivery);

    expect(calls.filter((c) => c.path === '/chats')).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith('/messages'))).toHaveLength(2);
  });

  it('puts everyone at the table on the card, with a confirm action', async () => {
    const { calls, channel } = teams();
    await channel.sendInvite(delivery);

    const message = calls[1]!.body as { attachments: { content: string }[] };
    const card = JSON.parse(message.attachments[0]!.content) as Record<string, unknown>;
    expect(JSON.stringify(card)).toContain('Ada Yılmaz');
    expect(JSON.stringify(card['actions'])).toContain('https://sofra.example.com/c/abc');
  });

  it('does not attempt a group chat it cannot legally create', async () => {
    // Graph rejects a group chat below three members; skip rather than throw.
    const { calls, channel } = teams();
    await channel.sendInvite({ ...delivery, members: members.slice(0, 2) });
    expect(calls).toHaveLength(0);
  });
});

describe('TeamsChannel app-only guard', () => {
  it('refuses to try, rather than failing at send time with a 403', async () => {
    // POST /chats/{id}/messages has no application permission beyond
    // Teamwork.Migrate.All, so client credentials cannot deliver this.
    const channel = new TeamsChannel({ graph: async () => ({ id: 'x' }) });
    await expect(channel.sendInvite(delivery)).rejects.toThrow(/app-only credentials/);
    await expect(channel.sendCancellation(delivery)).rejects.toThrow(/app-only credentials/);
  });

  it('says what would make it work', async () => {
    const channel = new TeamsChannel({ graph: async () => ({ id: 'x' }) });
    await expect(channel.sendInvite(delivery)).rejects.toThrow(/bot or delegated/);
  });

  it('never opens a chat it then cannot post into', async () => {
    const calls: string[] = [];
    const channel = new TeamsChannel({
      graph: async (_m, path) => {
        calls.push(path);
        return { id: 'x' };
      },
    });
    await expect(channel.sendInvite(delivery)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('CompositeChannel', () => {
  function spyChannel(name: string, fail = false): InviteChannel & { invites: number } {
    return {
      name,
      invites: 0,
      async sendInvite() {
        if (fail) throw new Error(`${name} is down`);
        this.invites++;
      },
      async sendCancellation() {},
    };
  }

  it('sends through every channel', async () => {
    const a = spyChannel('a');
    const b = spyChannel('b');
    await new CompositeChannel([a, b]).sendInvite(delivery);
    expect([a.invites, b.invites]).toEqual([1, 1]);
  });

  it('one channel being down does not stop the others', async () => {
    const broken = spyChannel('slack', true);
    const working = spyChannel('email');
    const onError = vi.fn();

    await new CompositeChannel([broken, working], onError).sendInvite(delivery);

    expect(working.invites).toBe(1);
    expect(onError).toHaveBeenCalledWith('slack', expect.any(Error));
  });
});
