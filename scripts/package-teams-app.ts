/**
 * Substitutes the manifest placeholders and zips the Teams app package.
 *
 *   SOFRA_BASE_URL=... SOFRA_DOMAIN=... AAD_CLIENT_ID=... TEAMS_APP_ID=... \
 *     npm run teams:package
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['SOFRA_BASE_URL', 'SOFRA_DOMAIN', 'AAD_CLIENT_ID', 'TEAMS_APP_ID'] as const;

function main(): void {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(', ')}\nSee teams/README.md.`);
    process.exit(1);
  }

  const manifest = REQUIRED.reduce(
    (text, name) => text.replaceAll(`\${{${name}}}`, process.env[name]!),
    readFileSync('teams/manifest.json', 'utf8'),
  );

  const leftover = manifest.match(/\$\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    // A placeholder shipped as-is produces an app Teams accepts and nothing
    // works, which is a miserable thing to debug.
    console.error(`Unsubstituted placeholders: ${[...new Set(leftover)].join(', ')}`);
    process.exit(1);
  }

  const staging = join('dist', 'teams');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  writeFileSync(join(staging, 'manifest.json'), manifest);
  for (const icon of ['color.png', 'outline.png']) {
    copyFileSync(join('teams', icon), join(staging, icon));
  }

  const archive = join('..', 'sofra-teams.zip');
  rmSync(join('dist', 'sofra-teams.zip'), { force: true });
  execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: staging });

  console.log('Wrote dist/sofra-teams.zip — upload it in Teams → Apps → Manage your apps.');
}

main();
