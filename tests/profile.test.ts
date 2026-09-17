import { describe, expect, it } from 'vitest';
import {
  MAX_INTERESTS,
  MAX_INTEREST_LENGTH,
  parseInterests,
  withProfile,
} from '../src/core/profile';
import { employee } from './helpers';

describe('parseInterests', () => {
  it('reads what somebody typed into a comma-separated box', () => {
    expect(parseInterests('running, chess, live music')).toEqual([
      'running',
      'chess',
      'live music',
    ]);
  });

  it('lowercases, because matching compares them literally', () => {
    // "Chess" and "chess" being different would quietly cost people the exact
    // thing the field exists for.
    expect(parseInterests('Chess, RUNNING')).toEqual(['chess', 'running']);
  });

  it('tolerates the separators people actually use', () => {
    expect(parseInterests('chess; running\nswimming')).toEqual(['chess', 'running', 'swimming']);
  });

  it('collapses the spacing rather than storing two of the same thing', () => {
    expect(parseInterests('live   music, live music')).toEqual(['live music']);
  });

  it('drops empties instead of storing a blank interest', () => {
    expect(parseInterests(', ,,')).toEqual([]);
    expect(parseInterests('')).toEqual([]);
  });

  it('stops at a sensible number and length', () => {
    const many = Array.from({ length: 40 }, (_, i) => `interest${i}`).join(',');
    expect(parseInterests(many)).toHaveLength(MAX_INTERESTS);
    expect(parseInterests('x'.repeat(200))[0]).toHaveLength(MAX_INTEREST_LENGTH);
  });
});

describe('withProfile', () => {
  const directory = employee('e1', { languages: ['en', 'nl'], interests: ['sailing'] });

  it('keeps the directory when somebody has said nothing', () => {
    // A company whose export does carry languages gets sensible matching before
    // anybody has opened the page.
    expect(withProfile(directory, null)).toEqual(directory);
  });

  it('prefers what the person said', () => {
    const merged = withProfile(directory, {
      employeeId: 'e1',
      languages: ['tr'],
      interests: ['climbing'],
      updatedAt: '2026-09-17T00:00:00.000Z',
    });

    expect(merged.languages).toEqual(['tr']);
    expect(merged.interests).toEqual(['climbing']);
  });

  it('treats an empty interest list as an answer', () => {
    const merged = withProfile(directory, {
      employeeId: 'e1',
      languages: ['en'],
      interests: [],
      updatedAt: '2026-09-17T00:00:00.000Z',
    });

    expect(merged.interests).toEqual([]);
  });

  it('never leaves somebody with no language at all', () => {
    // A table needs one everybody shares, so an empty list is not a preference,
    // it is being unmatchable.
    const merged = withProfile(directory, {
      employeeId: 'e1',
      languages: [],
      interests: ['climbing'],
      updatedAt: '2026-09-17T00:00:00.000Z',
    });

    expect(merged.languages).toEqual(['en', 'nl']);
  });

  it('changes nothing else about the directory record', () => {
    const merged = withProfile(directory, {
      employeeId: 'e1',
      languages: ['tr'],
      interests: [],
      updatedAt: '2026-09-17T00:00:00.000Z',
    });

    expect(merged.department).toBe(directory.department);
    expect(merged.email).toBe(directory.email);
    expect(merged.team).toBe(directory.team);
  });
});
