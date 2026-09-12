import { createRng } from '../core/rng.js';
import { SENIORITY_LADDER } from '../core/types.js';
import type { DeclaredGender, Employee, Seniority } from '../core/types.js';

/**
 * A synthetic company, so the engine can be demonstrated and regression-tested
 * without anyone's real HR data.
 */

const DEPARTMENTS = [
  { name: 'Engineering', teams: ['Platform', 'Payments', 'Search', 'Mobile', 'Data'], share: 0.4 },
  { name: 'Product', teams: ['Core Product', 'Growth'], share: 0.12 },
  { name: 'Design', teams: ['Product Design', 'Research'], share: 0.08 },
  { name: 'Sales', teams: ['Enterprise', 'SMB', 'Partnerships'], share: 0.18 },
  { name: 'Marketing', teams: ['Brand', 'Demand Gen'], share: 0.08 },
  { name: 'Finance', teams: ['FP&A', 'Accounting'], share: 0.07 },
  { name: 'People', teams: ['Talent', 'People Ops'], share: 0.07 },
] as const;

/** Realistically pyramid-shaped: plenty of mid, few directors. */
const SENIORITY_WEIGHTS: Record<Seniority, number> = {
  intern: 0.06,
  junior: 0.18,
  mid: 0.3,
  senior: 0.24,
  lead: 0.1,
  manager: 0.09,
  director: 0.03,
};

const TITLES: Record<Seniority, string> = {
  intern: 'Intern',
  junior: 'Associate',
  mid: 'Specialist',
  senior: 'Senior Specialist',
  lead: 'Lead',
  manager: 'Manager',
  director: 'Director',
};

const INTERESTS = [
  'running', 'climbing', 'board games', 'cooking', 'photography', 'cycling',
  'live music', 'football', 'chess', 'hiking', 'sci-fi', 'podcasts',
  'woodworking', 'gardening', 'sailing', 'basketball',
];

const GENDERS: DeclaredGender[] = ['female', 'male', 'non_binary', 'undisclosed'];
const GENDER_WEIGHTS = [0.44, 0.5, 0.02, 0.04];

const FIRST_NAMES = [
  'Ada', 'Deniz', 'Elif', 'Kerem', 'Mira', 'Onur', 'Selin', 'Tarık', 'Yusuf', 'Zeynep',
  'Anna', 'Bruno', 'Chloe', 'Diego', 'Emma', 'Felix', 'Greta', 'Hugo', 'Ines', 'Jonas',
  'Kaya', 'Lena', 'Marco', 'Nadia', 'Omar', 'Petra', 'Quinn', 'Rosa', 'Sven', 'Tomas',
];
const LAST_NAMES = [
  'Aydın', 'Bauer', 'Costa', 'Demir', 'Eriksson', 'Fischer', 'Garcia', 'Hoffmann',
  'Ivanov', 'Jansen', 'Kaya', 'Lopez', 'Moreau', 'Novak', 'Öztürk', 'Petrov',
  'Rossi', 'Schmidt', 'Tanaka', 'Yılmaz',
];

export interface CompanyOptions {
  size: number;
  offices: string[];
  seed: number;
  /** Locale mix per office, used to decide who speaks what. */
  officeLanguages?: Record<string, string[]>;
}

export function generateCompany(options: CompanyOptions): Employee[] {
  const rng = createRng(options.seed);
  const employees: Employee[] = [];

  for (let i = 0; i < options.size; i++) {
    const department = weightedPick(DEPARTMENTS, (d) => d.share, rng);
    const team = `${department.name}/${pick(department.teams, rng)}`;
    const seniority = weightedPick(
      SENIORITY_LADDER.slice(),
      (s) => SENIORITY_WEIGHTS[s],
      rng,
    ) as Seniority;
    const officeId = pick(options.offices, rng);
    const local = options.officeLanguages?.[officeId] ?? ['en'];

    // Everyone speaks English; most also speak the office's local language.
    const languages = ['en', ...(rng() < 0.75 ? local.filter((l) => l !== 'en') : [])];

    employees.push({
      id: `e${String(i + 1).padStart(4, '0')}`,
      displayName: `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`,
      email: `person${i + 1}@example.com`,
      title: TITLES[seniority],
      seniority,
      department: department.name,
      team,
      officeId,
      languages,
      tenureMonths: Math.floor(rng() ** 2 * 120), // skewed towards recent hires
      interests: pickMany(INTERESTS, 1 + Math.floor(rng() * 3), rng),
      dietary: rng() < 0.18 ? [pick(['vegetarian', 'vegan', 'halal', 'gluten-free'], rng)] : [],
      gender: weightedPick(GENDERS, (_, i) => GENDER_WEIGHTS[i] ?? 0, rng),
    });
  }

  return employees;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

function pickMany<T>(items: readonly T[], count: number, rng: () => number): T[] {
  const pool = items.slice();
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}

function weightedPick<T>(
  items: readonly T[],
  weight: (item: T, index: number) => number,
  rng: () => number,
): T {
  const total = items.reduce((sum, item, i) => sum + weight(item, i), 0);
  let threshold = rng() * total;
  for (let i = 0; i < items.length; i++) {
    threshold -= weight(items[i]!, i);
    if (threshold <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
