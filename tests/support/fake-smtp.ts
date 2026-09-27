import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';

export interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
  /** Whether the message travelled over TLS. */
  secure: boolean;
  user: string | null;
}

export interface FakeSmtp {
  port: number;
  /** The server certificate, PEM, to trust as a CA. */
  cert: string;
  received: ReceivedMail[];
  close(): Promise<void>;
}

/** A throwaway certificate for localhost, made with the system's openssl. */
export function selfSignedCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sofra-smtp-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Enough of an SMTP server to take a message the way a company relay does:
 * EHLO, STARTTLS, AUTH PLAIN or LOGIN, MAIL, RCPT, DATA. With `offerTls: false`
 * it behaves like a relay that never encrypts, which the transport must refuse.
 */
export async function startFakeSmtp(options: { offerTls?: boolean } = {}): Promise<FakeSmtp> {
  const offerTls = options.offerTls ?? true;
  const { key, cert } = selfSignedCertificate();
  const received: ReceivedMail[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    let socket: net.Socket | tls.TLSSocket = raw;
    let secure = false;
    let buffer = '';
    let inData = false;
    let data = '';
    let from = '';
    let to: string[] = [];
    let user: string | null = null;
    let authStep: 'user' | 'pass' | null = null;

    const reply = (line: string) => socket.write(`${line}\r\n`);

    const onLine = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          received.push({ from, to, data, secure, user });
          data = '';
          reply('250 OK queued');
        } else {
          data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
        }
        return;
      }
      if (authStep === 'user') {
        user = Buffer.from(line, 'base64').toString('utf8');
        authStep = 'pass';
        reply('334 UGFzc3dvcmQ6');
        return;
      }
      if (authStep === 'pass') {
        authStep = null;
        reply('235 Authenticated');
        return;
      }

      const [verb = '', ...rest] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
        case 'HELO':
          socket.write('250-localhost\r\n');
          if (offerTls && !secure) socket.write('250-STARTTLS\r\n');
          if (secure || !offerTls) socket.write('250-AUTH PLAIN LOGIN\r\n');
          reply('250 8BITMIME');
          break;
        case 'STARTTLS': {
          reply('220 Go ahead');
          raw.removeAllListeners('data');
          const upgraded = new tls.TLSSocket(raw, {
            isServer: true,
            secureContext: tls.createSecureContext({ key, cert }),
          });
          socket = upgraded;
          secure = true;
          buffer = '';
          upgraded.on('data', feed);
          upgraded.on('error', () => undefined);
          break;
        }
        case 'AUTH':
          if ((rest[0] ?? '').toUpperCase() === 'PLAIN') {
            const decoded = Buffer.from(rest[1] ?? '', 'base64')
              .toString('utf8')
              .split('\0');
            user = decoded[1] ?? null;
            reply('235 Authenticated');
          } else {
            authStep = 'user';
            reply('334 VXNlcm5hbWU6');
          }
          break;
        case 'MAIL':
          from = line.match(/<([^>]*)>/)?.[1] ?? '';
          to = [];
          reply('250 OK');
          break;
        case 'RCPT':
          to.push(line.match(/<([^>]*)>/)?.[1] ?? '');
          reply('250 OK');
          break;
        case 'DATA':
          inData = true;
          reply('354 End with <CR><LF>.<CR><LF>');
          break;
        case 'RSET':
          reply('250 OK');
          break;
        case 'QUIT':
          reply('221 Bye');
          socket.end();
          break;
        default:
          reply('502 Not implemented');
      }
    };

    function feed(chunk: Buffer) {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        onLine(line);
      }
    }

    raw.on('data', feed);
    raw.on('error', () => undefined);
    reply('220 localhost ESMTP fake');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    cert,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
