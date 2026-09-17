import type { Employee } from '../core/types';
import type { Directory } from './types';

/**
 * A directory that is already in memory.
 *
 * The synthetic company uses this, and so does every test, which is the point:
 * the store takes a directory rather than an array, so nothing in the
 * application can tell the difference between people from a fixture and people
 * from a company's export.
 */
export function staticDirectory(employees: readonly Employee[], name = 'static'): Directory {
  return {
    name,
    listEmployees: async () => [...employees],
  };
}
