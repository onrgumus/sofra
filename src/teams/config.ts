import { envOptional } from '../lib/env';

export interface BotConfig {
  /** The bot's Microsoft App ID, which is an Entra app registration's client id. */
  appId: string;
  appPassword: string;
  /** The tenant the bot's app registration lives in; bots are single-tenant here. */
  tenantId: string;
}

/**
 * The Teams bot, when this deployment has one. It can be the same app
 * registration as the tab and the directory (TEAMS_BOT_ID falls back to
 * MS_CLIENT_ID), which is one registration for IT to review instead of two.
 */
export function botConfig(): BotConfig | null {
  const appId = envOptional('TEAMS_BOT_ID');
  if (!appId) return null;
  const appPassword =
    envOptional('TEAMS_BOT_PASSWORD') ??
    (appId === envOptional('MS_CLIENT_ID') ? envOptional('MS_CLIENT_SECRET') : undefined);
  const tenantId = envOptional('TEAMS_BOT_TENANT_ID') ?? envOptional('MS_TENANT_ID');
  if (!appPassword || !tenantId) return null;
  return { appId, appPassword, tenantId };
}

/**
 * Where a bot may be told to send replies. The service URL arrives inside the
 * activity, and a bearer token is sent to it, so an unexpected host would be a
 * way to collect the bot's token. Only Microsoft's Bot Framework endpoints.
 */
export function trustedServiceUrl(serviceUrl: string): boolean {
  try {
    const url = new URL(serviceUrl);
    if (url.protocol !== 'https:') return false;
    return (
      url.hostname === 'smba.trafficmanager.net' ||
      url.hostname.endsWith('.botframework.com') ||
      url.hostname.endsWith('.teams.microsoft.com') ||
      url.hostname.endsWith('.trafficmanager.net')
    );
  } catch {
    return false;
  }
}
