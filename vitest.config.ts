import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * The suite runs against a real PostgreSQL: TEST_DATABASE_URL from the
 * environment, or from .env.test.local on a laptop. Each test file works in a
 * schema of its own, so files run in parallel without seeing each other.
 */
function localEnv(): Record<string, string> {
  if (!existsSync('.env.test.local')) return {};
  return Object.fromEntries(
    readFileSync('.env.test.local', 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

export default defineConfig({
  test: {
    env: { ...localEnv(), ...pickDefined(process.env) },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

function pickDefined(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
