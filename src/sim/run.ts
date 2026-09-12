/**
 * Runs the matcher over a synthetic company for several weeks and reports how it
 * behaves: who gets seated, how diverse the tables are, how often rules have to
 * bend, and how often people meet someone they already know.
 *
 *   npm run simulate -- --size 240 --weeks 8 --participation 0.35
 */
import { matchLunches } from '../core/matcher';
import { DEFAULT_CONFIG } from '../core/types';
import type { Employee, MatchResult, OptIn, PastMatch } from '../core/types';
import { createRng } from '../core/rng';
import { generateCompany } from './company';
import { buildInvite } from '../notify/invite';
import { pairKey } from '../core/history';

interface Args {
  size: number;
  weeks: number;
  participation: number;
  seed: number;
  office: string;
}

function parseArgs(argv: string[]): Args {
  const defaults: Args = { size: 240, weeks: 8, participation: 0.35, seed: 7, office: 'IST-HQ' };
  const args = { ...defaults };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (!key || value === undefined) continue;
    if (key === 'office') args.office = value;
    else if (key in args) (args as Record<string, unknown>)[key] = Number(value);
  }
  return args;
}

const OFFICES = ['IST-HQ', 'AMS-1'];
const OFFICE_LANGUAGES = { 'IST-HQ': ['en', 'tr'], 'AMS-1': ['en', 'nl'] };

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const employees = generateCompany({
    size: args.size,
    offices: OFFICES,
    seed: args.seed,
    officeLanguages: OFFICE_LANGUAGES,
  });

  const inOffice = employees.filter((e) => e.officeId === args.office);
  const rng = createRng(args.seed + 1);
  const history: PastMatch[] = [];
  const results: MatchResult[] = [];

  console.log(`Sofra simulation — ${args.size} employees, office ${args.office} (${inOffice.length} people)`);
  console.log(`${args.weeks} weekly lunches, ${(args.participation * 100).toFixed(0)}% opt-in rate\n`);

  for (let week = 0; week < args.weeks; week++) {
    const date = wednesdayOfWeek(week);
    const optIns: OptIn[] = inOffice
      .filter(() => rng() < args.participation)
      .map((e) => ({ employeeId: e.id, date, officeId: args.office, slot: '12:00' }));

    const result = matchLunches({
      date,
      officeId: args.office,
      slot: '12:00',
      employees,
      optIns,
      pastMatches: history,
      config: { ...DEFAULT_CONFIG, seed: args.seed + week },
    });

    results.push(result);
    for (const group of result.groups) {
      history.push({ date, memberIds: group.members.map((m) => m.id) });
    }

    console.log(
      `week ${String(week + 1).padStart(2)}  ${date}  ` +
        `opt-in ${String(optIns.length).padStart(3)}  ` +
        `tables ${String(result.groups.length).padStart(3)}  ` +
        `seated ${String(seated(result)).padStart(3)}  ` +
        `unseated ${result.unmatched.length}  ` +
        `avg score ${(result.totalScore / Math.max(1, result.groups.length)).toFixed(2)}`,
    );
  }

  report(results, history);
  printSampleInvite(results);
}

function seated(result: MatchResult): number {
  return result.groups.reduce((sum, g) => sum + g.members.length, 0);
}

function report(results: readonly MatchResult[], history: readonly PastMatch[]): void {
  const groups = results.flatMap((r) => r.groups);
  const totalSeated = results.reduce((sum, r) => sum + seated(r), 0);
  const totalOptIn = totalSeated + results.reduce((sum, r) => sum + r.unmatched.length, 0);

  const sizeCounts = new Map<number, number>();
  const relaxationCounts = new Map<string, number>();
  let sameDepartmentPairs = 0;
  let totalPairs = 0;
  let seniorityLevelsSum = 0;

  for (const group of groups) {
    sizeCounts.set(group.members.length, (sizeCounts.get(group.members.length) ?? 0) + 1);
    relaxationCounts.set(group.relaxation, (relaxationCounts.get(group.relaxation) ?? 0) + 1);
    seniorityLevelsSum += new Set(group.members.map((m) => m.seniority)).size;
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        totalPairs++;
        if (group.members[i]!.department === group.members[j]!.department) sameDepartmentPairs++;
      }
    }
  }

  const pairCounts = new Map<string, number>();
  for (const match of history) {
    for (let i = 0; i < match.memberIds.length; i++) {
      for (let j = i + 1; j < match.memberIds.length; j++) {
        const key = pairKey(match.memberIds[i]!, match.memberIds[j]!);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const repeatedPairs = [...pairCounts.values()].filter((c) => c > 1).length;

  console.log('\n--- summary ---');
  console.log(`seated               ${totalSeated}/${totalOptIn} opt-ins (${pct(totalSeated / totalOptIn)})`);
  console.log(
    `table sizes          ${[...sizeCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([size, count]) => `${size}p x${count}`)
      .join('  ')}`,
  );
  console.log(`cross-department     ${pct(1 - sameDepartmentPairs / totalPairs)} of pairs`);
  console.log(`seniority levels     ${(seniorityLevelsSum / groups.length).toFixed(2)} distinct per table`);
  console.log(`repeat pairings      ${repeatedPairs}/${pairCounts.size} pairs met more than once`);
  console.log(
    `rules bent           ${[...relaxationCounts.entries()]
      .map(([relaxation, count]) => `${relaxation} x${count}`)
      .join('  ')}`,
  );
}

function printSampleInvite(results: readonly MatchResult[]): void {
  const group = results[0]?.groups[0];
  if (!group) return;

  const invite = buildInvite({
    group,
    venue: {
      officeId: group.officeId,
      displayName: 'Istanbul HQ',
      timeZone: 'Europe/Istanbul',
      meetingPoint: 'Ground floor cafeteria, by the coffee bar',
    },
    organizer: { name: 'Sofra', email: 'sofra@example.com' },
    confirmUrl: 'https://sofra.example.com/c/abc123',
  });

  console.log('\n--- sample invite ---');
  console.log(`subject: ${invite.subject}\n`);
  console.log(invite.text);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Wednesdays, counting forward from a fixed Wednesday. */
function wednesdayOfWeek(week: number): string {
  const start = Date.parse('2026-09-16T00:00:00Z');
  return new Date(start + week * 7 * 86_400_000).toISOString().slice(0, 10);
}

main();
