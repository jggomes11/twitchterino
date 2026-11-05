'use strict';

const { createSessionClient, readCookie } = require('./requests');
const TWITCH = 'https://www.twitch.tv';
const KICK = 'https://kick.com';

function resolveTwitchUrl(input) {
  if (input !== '/gql') throw new Error('Invalid request');
  return 'https://gql.twitch.tv/gql';
}

function resolveKickUrl(input) {
  if (typeof input !== 'string' || !(
    /^\/api\/v[12]\/user$/.test(input)
    || /^\/api\/v2\/channels\/[a-z0-9_-]{2,30}(?:\/(?:me|points))?$/.test(input)
    || /^\/api\/v2\/messages\/send\/[1-9][0-9]{0,19}$/.test(input)
  )) throw new Error('Invalid request');
  return KICK + input;
}

function createPlatformClient(platform, getSession) {
  if (!['twitch', 'kick'].includes(platform)) throw new Error('Invalid platform');
  return createSessionClient({
    getSession,
    resolveUrl: platform === 'twitch' ? resolveTwitchUrl : resolveKickUrl,
    async getHeaders(session) {
      if (platform === 'twitch') {
        const token = await readCookie(session, TWITCH, 'auth-token');
        const device = await readCookie(session, TWITCH, 'unique_id');
        return {
          'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Content-Type': 'text/plain;charset=UTF-8',
          Origin: TWITCH, Referer: TWITCH + '/',
          ...(token ? { Authorization: 'OAuth ' + token } : {}),
          ...(device ? { 'X-Device-Id': device } : {}),
        };
      }
      const token = await readCookie(session, KICK, 'session_token');
      const xsrf = await readCookie(session, KICK, 'XSRF-TOKEN');
      return {
        Accept: 'application/json', 'Content-Type': 'application/json',
        Origin: KICK, Referer: KICK + '/',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
      };
    },
  });
}

module.exports = { resolveKickUrl, resolveTwitchUrl, createPlatformClient };

