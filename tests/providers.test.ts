import { describe, expect, it, vi } from 'vitest';
import { parseCsv, CsvAttendanceProvider } from '../src/providers/csv';
import { ManualAttendanceProvider } from '../src/providers/manual';
import { WebhookAttendanceProvider } from '../src/providers/webhook';
import { CompositeAttendanceProvider } from '../src/providers/composite';
import { MsGraphAttendanceProvider } from '../src/providers/msGraph';
import type { AttendanceProvider } from '../src/providers/types';

const QUERY = { date: '2026-09-16', officeId: 'IST-HQ' };

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n');
    expect(rows).toEqual([{ a: 'x,1', b: 'he said "hi"' }]);
  });

  it('ignores blank lines and trims cells', () => {
    expect(parseCsv('a,b\n 1 , 2 \n\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('CsvAttendanceProvider', () => {
  const csv = [
    'employee_id,office_id,date',
    'badge-1,IST-HQ,2026-09-16',
    'badge-2,IST-HQ,2026-09-17',
    'badge-3,AMS-1,2026-09-16',
    'contractor-9,IST-HQ,2026-09-16',
  ].join('\n');

  it('keeps only the requested day and office, and maps vendor ids', async () => {
    const provider = new CsvAttendanceProvider({
      load: async () => csv,
      // Contractors are not in the directory, so the resolver drops them.
      resolveEmployeeId: (id) => (id.startsWith('badge-') ? id.replace('badge-', 'e') : null),
    });

    expect(await provider.getAttendance(QUERY)).toEqual([
      { employeeId: 'e1', officeId: 'IST-HQ', date: '2026-09-16' },
    ]);
  });
});

describe('WebhookAttendanceProvider', () => {
  it('replaces the snapshot rather than appending to it', async () => {
    const provider = new WebhookAttendanceProvider();
    provider.ingest(QUERY, [{ employeeId: 'e1', ...QUERY }]);
    provider.ingest(QUERY, [{ employeeId: 'e2', ...QUERY }]);
    expect((await provider.getAttendance(QUERY)).map((r) => r.employeeId)).toEqual(['e2']);
  });

  it('deduplicates repeated people in one push', async () => {
    const provider = new WebhookAttendanceProvider();
    provider.ingest(QUERY, [
      { employeeId: 'e1', ...QUERY },
      { employeeId: 'e1', ...QUERY },
    ]);
    expect(await provider.getAttendance(QUERY)).toHaveLength(1);
  });
});

describe('CompositeAttendanceProvider', () => {
  it('unions sources and deduplicates people seen twice', async () => {
    const a = new ManualAttendanceProvider([{ employeeId: 'e1', ...QUERY }]);
    const b = new ManualAttendanceProvider([
      { employeeId: 'e1', ...QUERY },
      { employeeId: 'e2', ...QUERY },
    ]);
    const composite = new CompositeAttendanceProvider([a, b]);
    const ids = (await composite.getAttendance(QUERY)).map((r) => r.employeeId).sort();
    expect(ids).toEqual(['e1', 'e2']);
  });

  it('still serves lunch when one source is down', async () => {
    const broken: AttendanceProvider = {
      name: 'broken',
      getAttendance: async () => {
        throw new Error('vendor API is down');
      },
    };
    const onError = vi.fn();
    const composite = new CompositeAttendanceProvider(
      [broken, new ManualAttendanceProvider([{ employeeId: 'e1', ...QUERY }])],
      onError,
    );

    expect(await composite.getAttendance(QUERY)).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith('broken', expect.any(Error));
  });
});

describe('MsGraphAttendanceProvider', () => {
  function provider(events: Record<string, unknown[]>, extra = {}) {
    return new MsGraphAttendanceProvider({
      userIds: async () => Object.keys(events),
      graphGet: async (path) => {
        const user = decodeURIComponent(path.split('/')[2] ?? '');
        const value = events[user];
        if (!value) throw new Error('mailbox unavailable');
        return { value: value as Record<string, unknown>[] };
      },
      ...extra,
    });
  }

  it('counts people whose Outlook work location says office', async () => {
    const result = await provider({
      'ada@example.com': [{ workingLocationType: 'office' }],
      'bruno@example.com': [{ workingLocationType: 'home' }],
    }).getAttendance(QUERY);

    expect(result.map((r) => r.employeeId)).toEqual(['ada@example.com']);
  });

  it('tells buildings apart when office name patterns are configured', async () => {
    const result = await provider(
      {
        'ada@example.com': [
          { workingLocationType: 'office', location: { displayName: 'Istanbul HQ' } },
        ],
        'bruno@example.com': [
          { workingLocationType: 'office', location: { displayName: 'Amsterdam 1' } },
        ],
      },
      { officeNamePatterns: { 'IST-HQ': /istanbul/i } },
    ).getAttendance(QUERY);

    expect(result.map((r) => r.employeeId)).toEqual(['ada@example.com']);
  });

  it('skips an unreadable mailbox instead of failing the whole day', async () => {
    const result = await provider({
      'ada@example.com': [{ workingLocationType: 'office' }],
      'locked@example.com': null as never,
    }).getAttendance(QUERY);

    expect(result.map((r) => r.employeeId)).toEqual(['ada@example.com']);
  });
});
