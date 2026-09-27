/**
 * Substitutes the manifest placeholders and zips the Teams app package.
 *
 *   npm run teams:package          values from the environment or .env.local
 *   npm run teams:package:local    values from .env.teams.local, for a laptop
 *
 * Reads SOFRA_BASE_URL, AAD_CLIENT_ID and TEAMS_APP_ID, and TEAMS_BOT_ID when
 * there is a bot, which the server needs
 * too, so they live in the same file rather than being typed twice. A variable
 * already in the environment wins over the file.
 *
 * The domain is taken from the base URL rather than asked for separately,
 * because two values that must agree are two chances to disagree.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function main(): void {
  const envFile = process.argv[2] ?? '.env.local';
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  else if (process.argv[2]) {
    console.error(`${envFile} does not exist. Copy .env.teams.example to it and fill it in.`);
    process.exit(1);
  }

  const values = {
    SOFRA_BASE_URL: process.env.SOFRA_BASE_URL?.trim().replace(/\/+$/, ''),
    AAD_CLIENT_ID: process.env.AAD_CLIENT_ID?.trim(),
    TEAMS_APP_ID: process.env.TEAMS_APP_ID?.trim(),
    SOFRA_DOMAIN: '',
  };

  const problems: string[] = [];
  if (!values.SOFRA_BASE_URL?.startsWith('https://')) {
    // Teams loads a tab over HTTPS or not at all, and says only that the app
    // could not be reached.
    problems.push('SOFRA_BASE_URL must be the https:// address the server is reachable at');
  } else {
    values.SOFRA_DOMAIN = new URL(values.SOFRA_BASE_URL).host;
  }
  if (!values.AAD_CLIENT_ID || !GUID.test(values.AAD_CLIENT_ID)) {
    problems.push("AAD_CLIENT_ID must be the app registration's client id, a GUID");
  }
  if (!values.TEAMS_APP_ID || !GUID.test(values.TEAMS_APP_ID)) {
    // Kept, not generated here: uploading a package with a new id installs a
    // second app instead of updating the first.
    problems.push('TEAMS_APP_ID must be a GUID you generate once (uuidgen) and keep');
  }
  if (problems.length > 0) {
    console.error(`${problems.join('\n')}\nSee teams/README.md.`);
    process.exit(1);
  }

  const manifest = (Object.keys(values) as (keyof typeof values)[]).reduce(
    (text, name) => text.replaceAll(`\${{${name}}}`, values[name]!),
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

  // The bot, when this deployment has one: invites and the evening question
  // arrive as cards in each person's chat with it, answered in place.
  const botId = process.env.TEAMS_BOT_ID?.trim();
  if (botId && !GUID.test(botId)) {
    console.error("TEAMS_BOT_ID must be the bot's Microsoft App ID, a GUID");
    process.exit(1);
  }
  const packaged = JSON.parse(manifest) as Record<string, unknown>;
  if (botId) {
    packaged['bots'] = [
      { botId, scopes: ['personal'], supportsFiles: false, isNotificationOnly: false },
    ];
  }

  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(packaged, null, 2)}\n`);
  for (const icon of ['color.png', 'outline.png']) {
    copyFileSync(join('teams', icon), join(staging, icon));
  }

  const archive = join('..', 'sofra-teams.zip');
  rmSync(join('dist', 'sofra-teams.zip'), { force: true });
  execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: staging });

  console.log(
    `Wrote dist/sofra-teams.zip for ${values.SOFRA_DOMAIN}. Upload it in Teams → Apps → ` +
      'Manage your apps → Upload an app.',
  );
}

main();
