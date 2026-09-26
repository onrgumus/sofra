import type { Employee, Seniority } from '../core/types';
import { ENTRA, normaliseAddress } from './identity';
import type { Directory } from './types';

/** Authenticated GET against Graph, relative to `https://graph.microsoft.com/v1.0`. */
export type GraphGet = (path: string) => Promise<Record<string, unknown>>;

export interface EntraDirectoryOptions {
  /** Injected so this stays SDK-free and a test can hand it a fake tenant. */
  graphGet: GraphGet;
  /**
   * Which Sofra office somebody works in, read from Entra's `officeLocation`.
   *
   * That field is free text typed by whoever onboarded the person, so it says
   * "Istanbul HQ", "İstanbul - Maslak 5. kat" and "IST" for the same building.
   * Each office lists fragments; one found anywhere in the location, ignoring
   * case and Turkish dotted letters, puts the person there. When two offices
   * match, the longer fragment wins, because it is the more specific one.
   */
  officeLocations: Readonly<Record<string, readonly string[]>>;
  /**
   * Where somebody goes whose location matches no office. Unset, they are
   * skipped and counted. Set it only for a single-building company: guessing a
   * building for somebody in another city seats them at a lunch they cannot
   * reach.
   */
  defaultOfficeId?: string;
  /**
   * Only members of this group, direct or nested. How a pilot is run: IT
   * creates a group and nobody outside it is asked, matched or mailed.
   */
  groupId?: string;
  /**
   * An `onPremisesExtensionAttributes` slot holding each person's grade, e.g.
   * `extensionAttribute5`, for companies whose HR sync writes one. Read with
   * the same rules as a job title, and preferred over it.
   */
  seniorityAttribute?: string;
  /**
   * Keep people whose office or department cannot be read, with those left
   * empty, for a sync that lets each person fill them in at first sign-in
   * rather than leaving them out of the company.
   */
  lenient?: boolean;
  now?: () => number;
  /** Called once per read with what was left out and why. Default logs one line. */
  onSkipped?: (skipped: EntraSkip[]) => void;
}

export interface EntraSkip {
  userId: string;
  displayName: string;
  reason: string;
}

export interface EntraReadResult {
  employees: Employee[];
  skipped: EntraSkip[];
}

type GraphUser = Record<string, unknown>;

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

/**
 * The company's people, straight from the tenant it already signs in with.
 *
 * Where a CSV needs somebody in HR to produce and refresh an export, this needs
 * one application permission, `User.Read.All`, and the directory is simply
 * whatever Entra says today: a joiner is seatable within one cache refresh of
 * IT creating the account, and a leaver disappears when the account is
 * disabled, with nobody remembering to edit a file.
 *
 * Entra is not an HR system, so three things the matcher wants have to be
 * inferred, and each degrades the way the CSV reader's missing columns do:
 *
 *   - Seniority has no field. It comes from a grade attribute if the company
 *     has one, otherwise from the job title ("Kıdemli Uzman", "Engineering
 *     Manager"), otherwise the middle of the ladder.
 *   - The immediate team has no field either. People with the same manager are
 *     taken to be one team, which is the nearest thing the tenant records to
 *     "the people you already have lunch with".
 *   - Languages come from the preferred language, which people can correct on
 *     their own page.
 *
 * The object id is the employee id. It never changes, so opt-ins, history and
 * console grants survive somebody's name, address and department changing.
 */
export class EntraDirectory implements Directory {
  readonly name = 'entra';

  constructor(private readonly options: EntraDirectoryOptions) {}

  async listEmployees(): Promise<Employee[]> {
    const { employees, skipped } = await this.read();
    (this.options.onSkipped ?? summarise)(skipped);
    return employees;
  }

  /** The same read, with what was left out returned rather than reported. */
  async read(): Promise<EntraReadResult> {
    const [users, members] = await Promise.all([
      collect(this.options.graphGet, this.usersPath()),
      this.options.groupId ? this.groupMembers(this.options.groupId) : Promise.resolve(null),
    ]);

    return readEntraUsers(
      members ? users.filter((u) => members.has(String(u['id']))) : users,
      this.options,
    );
  }

  private usersPath(): string {
    const select = [
      'id',
      'displayName',
      'mail',
      'userPrincipalName',
      'proxyAddresses',
      'jobTitle',
      'department',
      'officeLocation',
      'preferredLanguage',
      'employeeHireDate',
      'accountEnabled',
      'userType',
      ...(this.options.seniorityAttribute ? ['onPremisesExtensionAttributes'] : []),
    ];
    // No $filter: combining one with $expand=manager needs advanced query mode
    // and has been unreliable, and the handful of accounts filtered out here
    // (disabled, guests, rooms) are cheap to drop in code.
    return `/users?$select=${select.join(',')}&$expand=manager($select=id)&$top=999`;
  }

  private async groupMembers(groupId: string): Promise<Set<string>> {
    const members = await collect(
      this.options.graphGet,
      `/groups/${encodeURIComponent(groupId)}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`,
    );
    return new Set(members.map((m) => String(m['id'])));
  }
}

/**
 * Turns Graph users into people Sofra can seat.
 *
 * Exported separately so the rules can be tested without paging, and so a
 * console can show what a tenant would produce before anybody switches to it.
 */
export function readEntraUsers(
  users: readonly GraphUser[],
  options: Pick<
    EntraDirectoryOptions,
    'officeLocations' | 'defaultOfficeId' | 'seniorityAttribute' | 'now' | 'lenient'
  >,
): EntraReadResult {
  const now = (options.now ?? Date.now)();
  const employees: Employee[] = [];
  const skipped: EntraSkip[] = [];
  // Every address already claimed, as in the CSV reader: two people sharing one
  // would make sign-in resolve to whichever was read first.
  const claimed = new Map<string, string>();

  for (const user of users) {
    const id = asString(user['id']);
    if (!id) continue;
    const displayName = asString(user['displayName']) ?? id;
    const skip = (reason: string) => skipped.push({ userId: id, displayName, reason });

    // Disabled accounts, guests, and accounts with no mailbox (rooms, service
    // accounts, the unlicensed) are the bulk of any tenant and none of them
    // eats lunch.
    if (user['accountEnabled'] === false) {
      skip('account disabled');
      continue;
    }
    const userType = asString(user['userType']);
    if (userType && userType !== 'Member') {
      skip(`${userType.toLowerCase()} account`);
      continue;
    }
    const mail = asString(user['mail']);
    if (!mail) {
      skip('no mailbox');
      continue;
    }
    const department = asString(user['department']) ?? (options.lenient ? '' : undefined);
    if (department === undefined) {
      // Required for the same reason the CSV requires it: every person without
      // one would count as one department, and as one team, and never sit
      // together.
      skip('no department');
      continue;
    }

    const hired = asDate(user['employeeHireDate']);
    if (hired && hired > now) {
      skip(`starts on ${new Date(hired).toISOString().slice(0, 10)}`);
      continue;
    }

    const location = asString(user['officeLocation']);
    const officeId =
      officeFor(location, options.officeLocations) ??
      options.defaultOfficeId ??
      (options.lenient ? '' : undefined);
    if (officeId === undefined) {
      skip(location ? `office "${location}" matches no office` : 'no office location');
      continue;
    }

    const aliases = aliasesOf(user, mail);
    const addresses = [mail, ...aliases].map((a) => a.toLowerCase());
    const collision = addresses.find((a) => claimed.has(a) && claimed.get(a) !== id);
    if (collision) {
      skip(`address ${collision} already belongs to ${claimed.get(collision)!}`);
      continue;
    }
    for (const address of addresses) claimed.set(address, id);

    const jobTitle = asString(user['jobTitle']);
    const grade = options.seniorityAttribute
      ? asString(asRecord(user['onPremisesExtensionAttributes'])?.[options.seniorityAttribute])
      : undefined;
    const managerId = asString(asRecord(user['manager'])?.['id']);

    employees.push({
      id,
      displayName,
      email: mail,
      title: jobTitle ?? department,
      seniority: seniorityFrom(grade) ?? seniorityFrom(jobTitle) ?? 'mid',
      department,
      // Somebody with no manager is usually at the top of a department, and the
      // department is the fallback the CSV reader uses too.
      team: managerId ? `manager:${managerId}` : department,
      officeId,
      languages: languagesFrom(asString(user['preferredLanguage'])),
      tenureMonths: hired ? monthsBetween(hired, now) : 0,
      interests: [],
      ...(aliases.length > 0 ? { aliases } : {}),
      externalIds: { [ENTRA]: id },
    });
  }

  return { employees, skipped };
}

/**
 * Seniority words in English and Turkish, most senior first, so "Senior
 * Manager" is a manager and "Genel Müdür Yardımcısı" is a director.
 *
 * English words are matched whole, so an "Internal Auditor" is not an intern and
 * a "Coordinator" is not a COO. Turkish words are matched as prefixes, because
 * the language suffixes them: "Satış Müdürü" has to mean a manager just as
 * "Sales Manager" does.
 */
const SENIORITY_WORDS: readonly [Seniority, RegExp][] = [
  [
    'director',
    /\b(director|vice president|head of|chief|vp|svp|evp|c[a-z]o)\b|\b(direktor|genel mudur)/,
  ],
  ['manager', /\bmanager\b|\b(mudur|yonetici)/],
  ['lead', /\b(lead|leader|principal)\b|\blider/],
  ['senior', /\b(senior|sr)\b|\bkidemli/],
  ['intern', /\b(intern|trainee)\b|\bstajyer/],
  ['junior', /\b(junior|jr|assistant)\b|\b(yardimci|asistan)/],
];

/** A grade or a job title to a rung on the ladder, or null when it says nothing. */
export function seniorityFrom(text: string | undefined): Seniority | null {
  if (!text) return null;
  const folded = fold(text);
  for (const [level, pattern] of SENIORITY_WORDS) {
    if (pattern.test(folded)) return level;
  }
  return null;
}

function officeFor(
  location: string | undefined,
  officeLocations: Readonly<Record<string, readonly string[]>>,
): string | null {
  if (!location) return null;
  const folded = fold(location);

  let best: { officeId: string; length: number } | null = null;
  for (const [officeId, fragments] of Object.entries(officeLocations)) {
    for (const fragment of fragments) {
      const wanted = fold(fragment).trim();
      if (wanted && folded.includes(wanted) && wanted.length > (best?.length ?? 0)) {
        best = { officeId, length: wanted.length };
      }
    }
  }
  return best?.officeId ?? null;
}

/**
 * The UPN when it is not the mail address, which in a great many tenants it is
 * not, and every SMTP proxy address. Without the UPN, the Teams token (which
 * carries it) would still find the person by object id, but a desk-booking
 * feed or Slack that knows them by a secondary address would not.
 */
function aliasesOf(user: GraphUser, mail: string): string[] {
  const primary = normaliseAddress(mail);
  const proxies = Array.isArray(user['proxyAddresses'])
    ? user['proxyAddresses']
        .filter((p): p is string => typeof p === 'string' && /^smtp:/i.test(p))
        .map((p) => p.slice(5))
    : [];

  const all = [asString(user['userPrincipalName']), ...proxies]
    .map(normaliseAddress)
    .filter((a): a is string => a !== null && a !== primary);
  return [...new Set(all)];
}

/** "tr-TR" to ["tr"]. Nothing set means English, as it does in the CSV. */
function languagesFrom(preferred: string | undefined): string[] {
  const code = preferred?.slice(0, 2).toLowerCase();
  return code && /^[a-z]{2}$/.test(code) ? [code] : ['en'];
}

function monthsBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) -
    (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  return Math.max(0, months);
}

/** Case, accents and the Turkish dotless i, so "İSTANBUL" finds "istanbul". */
function fold(text: string): string {
  return text.replace(/ı/g, 'i').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Every page of a Graph collection. The next link is absolute, and the client
 * prepends the version root itself, so it is made relative again; one that
 * points anywhere else is refused rather than followed.
 */
async function collect(graphGet: GraphGet, firstPath: string): Promise<GraphUser[]> {
  const items: GraphUser[] = [];
  let path: string | undefined = firstPath;

  while (path) {
    const page = await graphGet(path);
    const value = page['value'];
    if (Array.isArray(value)) {
      for (const item of value) {
        const record = asRecord(item);
        if (record) items.push(record);
      }
    }

    const next = page['@odata.nextLink'];
    if (typeof next !== 'string') break;
    if (!next.startsWith(GRAPH_ROOT)) throw new Error(`Unexpected Graph next link: ${next}`);
    path = next.slice(GRAPH_ROOT.length);
  }

  return items;
}

/** One line per read, not one per account: a tenant has thousands of rooms and guests. */
function summarise(skipped: EntraSkip[]): void {
  if (skipped.length === 0) return;

  const counts = new Map<string, number>();
  for (const { reason } of skipped) {
    // Group "office "X" matches no office" by kind, not by every distinct X.
    const kind = reason.startsWith('office ')
      ? 'office matches no office'
      : reason.startsWith('starts on')
        ? 'not started yet'
        : reason.startsWith('address ')
          ? 'address already taken'
          : reason;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  const detail = [...counts].map(([kind, n]) => `${kind}: ${n}`).join(', ');
  console.warn(`[directory] entra: skipped ${skipped.length} accounts (${detail})`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asDate(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}
