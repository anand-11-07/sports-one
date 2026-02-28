const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SPORTSDB_BASE_URL = process.env.SPORTSDB_BASE_URL || 'https://www.thesportsdb.com/api/v1/json';
const SPORTSDB_API_KEY = process.env.SPORTSDB_API_KEY || '3';
const SPORTSDB_MAX_RETRIES = Number(process.env.SPORTSDB_MAX_RETRIES || 3);

function readStore() {
  const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(store.sportRequests)) {
    store.sportRequests = [];
  }
  if (!Array.isArray(store.sports)) {
    store.sports = [];
  }
  if (!Array.isArray(store.teams)) {
    store.teams = [];
  }
  if (!Array.isArray(store.players)) {
    store.players = [];
  }
  if (!Array.isArray(store.leagues)) {
    store.leagues = [];
  }
  if (!Array.isArray(store.follows)) {
    store.follows = [];
  }
  if (!store.userSportOrder || typeof store.userSportOrder !== 'object') {
    store.userSportOrder = {};
  }
  if (!Array.isArray(store.syncHistory)) {
    store.syncHistory = [];
  }
  if (!store.catalogSyncState || typeof store.catalogSyncState !== 'object') {
    store.catalogSyncState = {};
  }
  if (!store.feedCacheBySport || typeof store.feedCacheBySport !== 'object') {
    store.feedCacheBySport = {};
  }
  return store;
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, saltedHash) {
  const [salt, hash] = saltedHash.split(':');
  const attempt = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string'))];
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildFeedPreferenceKey(sportId, teamIds, playerIds, leagueIds) {
  const t = [...new Set(teamIds)].sort().join(',');
  const p = [...new Set(playerIds)].sort().join(',');
  const l = [...new Set(leagueIds)].sort().join(',');
  return `${sportId}|t:${t}|p:${p}|l:${l}`;
}

async function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sportsDbGet(endpoint, params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  const url = `${SPORTSDB_BASE_URL}/${SPORTSDB_API_KEY}/${endpoint}${query ? `?${query}` : ''}`;
  for (let attempt = 0; attempt <= SPORTSDB_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });

      if (response.status === 429) {
        if (attempt >= SPORTSDB_MAX_RETRIES) {
          throw new Error('SportsDB request failed (429)');
        }
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      if (!response.ok) {
        throw new Error(`SportsDB request failed (${response.status})`);
      }

      const raw = await response.text();
      if (!raw || !raw.trim()) {
        return {};
      }
      try {
        return JSON.parse(raw);
      } catch (_) {
        return {};
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return {};
}

function extractText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return match[1]
    .replace(/<!\\[CDATA\\[|\\]\\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function fetchGoogleNewsRss(query, limit = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    return items.slice(0, limit).map((item) => ({
      type: 'news',
      title: extractText(item, 'title'),
      link: extractText(item, 'link'),
      date: extractText(item, 'pubDate') || null,
      source: 'Google News',
    }));
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function pushSyncHistory(store, payload) {
  store.syncHistory.unshift({
    id: newId('sync'),
    createdAt: new Date().toISOString(),
    ...payload,
  });
  if (store.syncHistory.length > 50) {
    store.syncHistory = store.syncHistory.slice(0, 50);
  }
}

function upsertSportFromSportsDb(store, row) {
  const name = String(row.strSport || '').trim();
  if (!name) return null;
  const externalId = String(row.idSport || '').trim() || null;
  const normalized = normalizeName(name);
  const existing = store.sports.find(
    (sport) =>
      (externalId && sport.externalId === externalId && sport.externalSource === 'sportsdb') ||
      normalizeName(sport.name) === normalized
  );
  if (existing) {
    if (externalId) {
      existing.externalSource = 'sportsdb';
      existing.externalId = externalId;
    }
    return existing;
  }

  const popular = new Set([
    'soccer',
    'basketball',
    'american football',
    'baseball',
    'cricket',
    'tennis',
    'formula 1',
    'mixed martial arts',
    'ice hockey',
    'golf',
  ]);

  const sport = {
    id: `sp_${crypto.randomBytes(4).toString('hex')}`,
    name,
    slug: slugify(name),
    isPopular: popular.has(normalized),
    externalSource: externalId ? 'sportsdb' : undefined,
    externalId: externalId || undefined,
  };
  store.sports.push(sport);
  return sport;
}

function upsertLeagueFromSportsDb(store, row) {
  const name = String(row.strLeague || '').trim();
  const sportName = String(row.strSport || '').trim();
  if (!name || !sportName) return null;

  const sport = store.sports.find((item) => normalizeName(item.name) === normalizeName(sportName));
  if (!sport) return null;

  const externalId = String(row.idLeague || '').trim() || null;
  const existing = store.leagues.find(
    (league) =>
      league.sportId === sport.id &&
      ((externalId && league.externalId === externalId && league.externalSource === 'sportsdb') ||
        normalizeName(league.name) === normalizeName(name))
  );
  if (existing) {
    if (externalId) {
      existing.externalSource = 'sportsdb';
      existing.externalId = externalId;
    }
    return existing;
  }

  const league = {
    id: `lg_${crypto.randomBytes(4).toString('hex')}`,
    sportId: sport.id,
    name,
    slug: slugify(name),
    externalSource: externalId ? 'sportsdb' : undefined,
    externalId: externalId || undefined,
  };
  store.leagues.push(league);
  return league;
}

function upsertTeamFromSportsDb(store, sportId, row) {
  const name = String(row.strTeam || '').trim();
  if (!name) return null;
  const externalId = String(row.idTeam || '').trim() || null;
  const existing = store.teams.find(
    (team) =>
      team.sportId === sportId &&
      ((externalId && team.externalId === externalId && team.externalSource === 'sportsdb') ||
        normalizeName(team.name) === normalizeName(name))
  );
  if (existing) {
    if (externalId) {
      existing.externalSource = 'sportsdb';
      existing.externalId = externalId;
    }
    return existing;
  }
  const team = {
    id: `tm_${crypto.randomBytes(4).toString('hex')}`,
    sportId,
    name,
    slug: slugify(name),
    externalSource: externalId ? 'sportsdb' : undefined,
    externalId: externalId || undefined,
  };
  store.teams.push(team);
  return team;
}

function upsertPlayerFromSportsDb(store, sportId, teamId, row) {
  const name = String(row.strPlayer || '').trim();
  if (!name) return null;
  const externalId = String(row.idPlayer || '').trim() || null;
  const existing = store.players.find(
    (player) =>
      player.sportId === sportId &&
      ((externalId && player.externalId === externalId && player.externalSource === 'sportsdb') ||
        normalizeName(player.name) === normalizeName(name))
  );
  if (existing) {
    if (externalId) {
      existing.externalSource = 'sportsdb';
      existing.externalId = externalId;
    }
    if (teamId) existing.teamId = teamId;
    return existing;
  }
  const player = {
    id: `pl_${crypto.randomBytes(4).toString('hex')}`,
    sportId,
    teamId: teamId || null,
    name,
    externalSource: externalId ? 'sportsdb' : undefined,
    externalId: externalId || undefined,
  };
  store.players.push(player);
  return player;
}

function getRealCatalogForSport(store, sportId) {
  return {
    teams: store.teams.filter((team) => team.sportId === sportId && team.externalSource === 'sportsdb' && team.externalId),
    players: store.players.filter((player) => player.sportId === sportId && player.externalSource === 'sportsdb' && player.externalId),
    leagues: store.leagues.filter((league) => league.sportId === sportId && league.externalSource === 'sportsdb' && league.externalId),
  };
}

async function syncSportCatalogFromSportsDb(store, sportId, options = {}) {
  const force = Boolean(options.force);
  const maxTeams = Number(options.maxTeams || 120);
  const maxLeagues = Number(options.maxLeagues || 8);
  const playersPerTeamCap = Number(options.playersPerTeamCap || 20);
  const maxPlayerTeams = Number(options.maxPlayerTeams || 24);
  const maxDurationMs = Number(options.maxDurationMs || 12000);
  const cooldownMs = Number(options.cooldownMs || 15 * 60 * 1000);
  const sport = store.sports.find((item) => item.id === sportId);
  if (!sport) {
    return { ok: false, reason: 'sport_not_found', createdTeams: 0, createdPlayers: 0, createdLeagues: 0 };
  }

  const state = store.catalogSyncState[sportId] || {};
  const now = Date.now();
  const existingCatalog = getRealCatalogForSport(store, sportId);
  const needsEnrichment = existingCatalog.teams.length < 40 || existingCatalog.players.length < 80;
  if (!force && state.lastSuccessAt && now - new Date(state.lastSuccessAt).getTime() < cooldownMs && !needsEnrichment) {
    return { ok: true, skipped: true, createdTeams: 0, createdPlayers: 0, createdLeagues: 0 };
  }

  let createdTeams = 0;
  let createdPlayers = 0;
  let createdLeagues = 0;
  let touchedTeams = 0;
  let touchedPlayerTeams = 0;
  const startedAt = Date.now();
  const isTimeUp = () => Date.now() - startedAt >= maxDurationMs;

  try {
    const leaguesData = await sportsDbGet('all_leagues.php');
    const allLeagues = Array.isArray(leaguesData?.leagues) ? leaguesData.leagues : [];
    allLeagues
      .filter((row) => normalizeName(row.strSport) === normalizeName(sport.name))
      .forEach((row) => {
        const before = store.leagues.length;
        upsertLeagueFromSportsDb(store, row);
        if (store.leagues.length > before) createdLeagues += 1;
      });

    const sportLeagues = store.leagues
      .filter((league) => league.sportId === sportId && league.externalSource === 'sportsdb' && league.externalId)
      .slice(0, maxLeagues);
    const seenTeamExternalIds = new Set();

    for (const league of sportLeagues) {
      if (isTimeUp()) break;
      let teams = [];
      try {
        const teamsData = await sportsDbGet('search_all_teams.php', { l: league.name });
        teams = Array.isArray(teamsData?.teams) ? teamsData.teams : [];
      } catch (_) {
        teams = [];
      }
      for (const teamRow of teams) {
        if (isTimeUp()) break;
        const teamExternalId = String(teamRow.idTeam || '').trim();
        if (teamExternalId && seenTeamExternalIds.has(teamExternalId)) continue;
        if (teamExternalId) seenTeamExternalIds.add(teamExternalId);
        if (touchedTeams >= maxTeams) break;

        const beforeTeams = store.teams.length;
        const team = upsertTeamFromSportsDb(store, sportId, teamRow);
        if (!team) continue;
        touchedTeams += 1;
        if (store.teams.length > beforeTeams) createdTeams += 1;

        if (!team.externalId || touchedPlayerTeams >= maxPlayerTeams) continue;
        let players = [];
        try {
          const playersData = await sportsDbGet('lookup_all_players.php', { id: team.externalId });
          players = Array.isArray(playersData?.player) ? playersData.player : [];
        } catch (_) {
          players = [];
        }
        if (players.length > 0) {
          touchedPlayerTeams += 1;
          players.slice(0, playersPerTeamCap).forEach((playerRow) => {
            const beforePlayers = store.players.length;
            upsertPlayerFromSportsDb(store, sportId, team.id, playerRow);
            if (store.players.length > beforePlayers) createdPlayers += 1;
          });
        }
      }
      if (touchedTeams >= maxTeams) break;
    }

    // Soccer fallback: if league-based team lookup is sparse, broaden by country to increase options.
    if (normalizeName(sport.name) === 'soccer' && touchedTeams < Math.min(maxTeams, 40)) {
      const popularCountries = ['England', 'Spain', 'Germany', 'Italy', 'France', 'Netherlands', 'Portugal', 'Brazil'];
      for (const country of popularCountries) {
        if (isTimeUp()) break;
        if (touchedTeams >= maxTeams) break;
        let teams = [];
        try {
          const countryData = await sportsDbGet('search_all_teams.php', { s: sport.name, c: country });
          teams = Array.isArray(countryData?.teams) ? countryData.teams : [];
        } catch (_) {
          teams = [];
        }
        for (const teamRow of teams) {
          if (isTimeUp()) break;
          const teamExternalId = String(teamRow.idTeam || '').trim();
          if (teamExternalId && seenTeamExternalIds.has(teamExternalId)) continue;
          if (teamExternalId) seenTeamExternalIds.add(teamExternalId);
          if (touchedTeams >= maxTeams) break;

          const beforeTeams = store.teams.length;
          const team = upsertTeamFromSportsDb(store, sportId, teamRow);
          if (!team) continue;
          touchedTeams += 1;
          if (store.teams.length > beforeTeams) createdTeams += 1;
        }
      }
    }

    const real = getRealCatalogForSport(store, sportId);
    const hasEntityData = real.teams.length > 0 || real.players.length > 0;
    const hasData = hasEntityData || real.leagues.length > 0;
    const timedOut = isTimeUp();
    const status = timedOut ? 'partial' : hasEntityData ? 'ok' : hasData ? 'partial' : 'no_data';
    store.catalogSyncState[sportId] = {
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: hasData ? new Date().toISOString() : state.lastSuccessAt || null,
      status,
      timedOut,
      touchedTeams,
      touchedPlayerTeams,
      createdTeams,
      createdPlayers,
      createdLeagues,
    };
    pushSyncHistory(store, {
      source: 'sportsdb',
      type: 'catalog',
      status,
      sportId,
      timedOut,
      touchedTeams,
      touchedPlayerTeams,
      createdTeams,
      createdPlayers,
      createdLeagues,
    });
    return { ok: true, status, timedOut, createdTeams, createdPlayers, createdLeagues, touchedTeams };
  } catch (err) {
    store.catalogSyncState[sportId] = {
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: state.lastSuccessAt || null,
      status: 'error',
      error: err.message,
      touchedTeams,
      touchedPlayerTeams,
      createdTeams,
      createdPlayers,
      createdLeagues,
    };
    pushSyncHistory(store, {
      source: 'sportsdb',
      type: 'catalog',
      status: 'error',
      sportId,
      error: err.message,
    });
    return { ok: false, reason: 'provider_error', error: err.message, createdTeams, createdPlayers, createdLeagues, touchedTeams, touchedPlayerTeams };
  }
}

async function fetchSportHighlightsFromSportsDb(store, sportId, limit = 3, preferredLeagueIds = []) {
  const preferredSet = new Set(preferredLeagueIds);
  const allSportLeagues = store.leagues.filter(
    (league) => league.sportId === sportId && league.externalSource === 'sportsdb' && league.externalId
  );
  const sportLeagues =
    preferredSet.size > 0
      ? allSportLeagues.filter((league) => preferredSet.has(league.id))
      : allSportLeagues;
  if (sportLeagues.length === 0) return [];

  const highlights = [];
  for (const league of sportLeagues.slice(0, 2)) {
    let data = null;
    try {
      data = await sportsDbGet('eventsnextleague.php', { id: league.externalId });
      const hasEvents = Array.isArray(data?.events) && data.events.length > 0;
      if (!hasEvents) {
        data = await sportsDbGet('eventspastleague.php', { id: league.externalId });
      }
    } catch (_) {
      try {
        data = await sportsDbGet('eventspastleague.php', { id: league.externalId });
      } catch (_) {
        data = null;
      }
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    const matchedEvents = events.filter((event) => {
      const eventLeagueId = String(event.idLeague || '').trim();
      const eventLeagueName = normalizeName(event.strLeague || '');
      const selectedLeagueId = String(league.externalId || '').trim();
      const selectedLeagueName = normalizeName(league.name || '');
      if (selectedLeagueId && eventLeagueId) {
        return selectedLeagueId === eventLeagueId;
      }
      if (selectedLeagueName && eventLeagueName) {
        return selectedLeagueName === eventLeagueName;
      }
      return true;
    });
    matchedEvents.slice(0, limit).forEach((event) => {
      highlights.push({
        league: event.strLeague || league.name,
        title: event.strEvent || `${event.strHomeTeam || ''} vs ${event.strAwayTeam || ''}`.trim(),
        date: event.dateEvent || null,
        time: event.strTime || null,
      });
    });
    if (highlights.length >= limit) break;
  }
  return highlights.slice(0, limit);
}

function searchSports(store, query, limit = 20) {
  const normalizedQuery = normalizeName(query);
  const sports = store.sports.map((sport) => ({ ...sport, isPopular: Boolean(sport.isPopular) }));

  const filtered = normalizedQuery
    ? sports.filter((sport) => {
        const haystack = normalizeName(`${sport.name} ${sport.slug || ''}`);
        return haystack.includes(normalizedQuery);
      })
    : sports.filter((sport) => sport.isPopular);

  filtered.sort((a, b) => {
    if (a.isPopular !== b.isPopular) return a.isPopular ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return filtered.slice(0, limit);
}

function requireAdmin(req, res) {
  const adminKey = req.headers['x-admin-key'];
  const expected = process.env.ADMIN_KEY || 'sports-one-admin';
  if (adminKey !== expected) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

function getSessionUser(req, store) {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (!sid) return null;
  const session = store.sessions.find((s) => s.id === sid);
  if (!session) return null;
  const user = store.users.find((u) => u.id === session.userId);
  return user || null;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function staticFilePath(urlPath) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const requestedPath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!requestedPath.startsWith(PUBLIC_DIR)) return null;
  return requestedPath;
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function groupBySport(store) {
  return store.sports.map((sport) => ({
    ...sport,
    teams: store.teams.filter((team) => team.sportId === sport.id),
    players: store.players.filter((player) => player.sportId === sport.id),
    leagues: store.leagues.filter((league) => league.sportId === sport.id),
  }));
}

function getUserInterests(store, userId) {
  const follows = store.follows.filter((f) => f.userId === userId);
  const followedSportIds = follows.filter((f) => f.entityType === 'sport').map((f) => f.entityId);
  const explicitOrder = Array.isArray(store.userSportOrder[userId]) ? store.userSportOrder[userId] : [];
  const inExplicit = explicitOrder.filter((id) => followedSportIds.includes(id));
  const remainder = followedSportIds.filter((id) => !inExplicit.includes(id));
  return {
    sportIds: [...inExplicit, ...remainder],
    teamIds: follows.filter((f) => f.entityType === 'team').map((f) => f.entityId),
    playerIds: follows.filter((f) => f.entityType === 'player').map((f) => f.entityId),
    leagueIds: follows.filter((f) => f.entityType === 'league').map((f) => f.entityId),
  };
}

function getEntitySportId(store, entityType, entityId) {
  if (entityType === 'team') return store.teams.find((team) => team.id === entityId)?.sportId || null;
  if (entityType === 'player') return store.players.find((player) => player.id === entityId)?.sportId || null;
  if (entityType === 'league') return store.leagues.find((league) => league.id === entityId)?.sportId || null;
  return null;
}

function upsertUserFollows(store, userId, items) {
  const now = new Date().toISOString();
  const existing = new Set(store.follows.filter((f) => f.userId === userId).map((f) => `${f.entityType}:${f.entityId}`));
  for (const item of items) {
    const key = `${item.entityType}:${item.entityId}`;
    if (existing.has(key)) continue;
    store.follows.push({ id: newId('fol'), userId, entityType: item.entityType, entityId: item.entityId, createdAt: now });
    existing.add(key);
  }
}

async function handleApi(req, res, url) {
  const store = readStore();

  if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
    const body = await parseJsonBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();

    if (!isValidEmail(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }

    if (!isStrongPassword(password)) {
      return sendJson(res, 400, { error: 'Password must be 8+ chars and include at least 1 letter and 1 number.' });
    }

    if (store.users.some((u) => u.email === email)) {
      return sendJson(res, 409, { error: 'User already exists.' });
    }

    const user = {
      id: newId('usr'),
      email,
      name: name || email.split('@')[0],
      passwordHash: createPasswordHash(password),
      createdAt: new Date().toISOString(),
    };

    store.users.push(user);
    const sid = newId('sid');
    store.sessions.push({ id: sid, userId: user.id, createdAt: new Date().toISOString() });
    writeStore(store);

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/${secure}`);
    return sendJson(res, 201, {
      user: { id: user.id, email: user.email, name: user.name },
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await parseJsonBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');

    if (!isValidEmail(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }

    const user = store.users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'Invalid credentials.' });
    }

    const sid = newId('sid');
    store.sessions.push({ id: sid, userId: user.id, createdAt: new Date().toISOString() });
    writeStore(store);

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/${secure}`);
    return sendJson(res, 200, {
      user: { id: user.id, email: user.email, name: user.name },
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const sid = parseCookies(req).sid;
    if (sid) {
      store.sessions = store.sessions.filter((s) => s.id !== sid);
      writeStore(store);
    }
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  const user = getSessionUser(req, store);

  if (req.method === 'GET' && url.pathname === '/api/me') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
  }

  if (req.method === 'GET' && url.pathname === '/api/onboarding/options') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, { sports: groupBySport(store) });
  }

  if (req.method === 'GET' && url.pathname === '/api/catalog/sports') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const query = String(url.searchParams.get('q') || '');
    const limit = Number(url.searchParams.get('limit') || 20);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
    const sports = searchSports(store, query, safeLimit);
    return sendJson(res, 200, { sports, query });
  }

  if (req.method === 'GET' && url.pathname === '/api/home/feed') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const interests = getUserInterests(store, user.id);
    const sports = interests.sportIds
      .map((sportId) => store.sports.find((sport) => sport.id === sportId))
      .filter(Boolean);
    const teamSet = new Set(interests.teamIds);
    const playerSet = new Set(interests.playerIds);
    const leagueSet = new Set(interests.leagueIds);

    const sections = [];
    const cacheTtlMs = 5 * 60 * 1000;
    let liveFetches = 0;
    let cacheUpdated = false;
    for (const sport of sports) {
      const selectedTeamIdsForSport = interests.teamIds.filter((teamId) =>
        store.teams.some((team) => team.id === teamId && team.sportId === sport.id)
      );
      const selectedPlayerIdsForSport = interests.playerIds.filter((playerId) =>
        store.players.some((player) => player.id === playerId && player.sportId === sport.id)
      );
      const selectedLeagueIdsForSport = interests.leagueIds.filter((leagueId) =>
        store.leagues.some((league) => league.id === leagueId && league.sportId === sport.id)
      );
      const selectedLeagueNamesForSport = store.leagues
        .filter((league) => selectedLeagueIdsForSport.includes(league.id))
        .map((league) => league.name);
      const preferenceKey = buildFeedPreferenceKey(
        sport.id,
        selectedTeamIdsForSport,
        selectedPlayerIdsForSport,
        selectedLeagueIdsForSport
      );
      const sportCache = store.feedCacheBySport[sport.id];
      const cacheEntry =
        sportCache && typeof sportCache === 'object' && !Array.isArray(sportCache) && !sportCache.fetchedAt
          ? sportCache[preferenceKey]
          : null;
      const cacheAgeMs = cacheEntry?.fetchedAt ? Date.now() - new Date(cacheEntry.fetchedAt).getTime() : Infinity;
      const cacheFresh = cacheEntry && cacheAgeMs >= 0 && cacheAgeMs <= cacheTtlMs;
      let highlights = Array.isArray(cacheEntry?.highlights) ? cacheEntry.highlights.slice(0, 3) : [];
      let news = Array.isArray(cacheEntry?.news) ? cacheEntry.news.slice(0, 3) : [];

      if (!cacheFresh && liveFetches < 2) {
        liveFetches += 1;
        highlights = await withTimeout(
          fetchSportHighlightsFromSportsDb(store, sport.id, 3, selectedLeagueIdsForSport),
          1800,
          highlights
        );
        const primaryNewsQuery = selectedLeagueNamesForSport[0] || `${sport.name} latest sports news`;
        const items = await withTimeout(fetchGoogleNewsRss(`${primaryNewsQuery}`, 3), 1800, []);
        news = Array.isArray(items) ? items.map((item) => ({ ...item, league: primaryNewsQuery })) : [];
        if (news.length === 0 && highlights.length > 0) {
          news = highlights.map((item) => ({
            type: 'match-update',
            title: item.title || `${sport.name} update`,
            date: [item.date, item.time].filter(Boolean).join(' ') || null,
            link: null,
            source: item.league || sport.name,
          }));
        }
        const nextSportCache =
          sportCache && typeof sportCache === 'object' && !Array.isArray(sportCache) && !sportCache.fetchedAt
            ? { ...sportCache }
            : {};
        nextSportCache[preferenceKey] = {
          fetchedAt: new Date().toISOString(),
          highlights: highlights.slice(0, 3),
          news: news.slice(0, 3),
        };
        const entries = Object.entries(nextSportCache).sort((a, b) => {
          const aTime = new Date((a[1] && a[1].fetchedAt) || 0).getTime();
          const bTime = new Date((b[1] && b[1].fetchedAt) || 0).getTime();
          return bTime - aTime;
        });
        store.feedCacheBySport[sport.id] = Object.fromEntries(entries.slice(0, 8));
        cacheUpdated = true;
      }

      sections.push({
        sport,
        counts: {
          teams: store.teams.filter((team) => team.sportId === sport.id && teamSet.has(team.id)).length,
          players: store.players.filter((player) => player.sportId === sport.id && playerSet.has(player.id)).length,
          leagues: store.leagues.filter((league) => league.sportId === sport.id && leagueSet.has(league.id)).length,
        },
        highlights,
        news: news.slice(0, 3),
      });
    }
    if (cacheUpdated) writeStore(store);
    return sendJson(res, 200, { sections, total: sections.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/me/sports') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await parseJsonBody(req);
    const sportIds = normalizeIdArray(body.sportIds);
    if (sportIds.length === 0) {
      return sendJson(res, 400, { error: 'Select at least one sport.' });
    }

    const validSportIds = new Set(store.sports.map((s) => s.id));
    if (sportIds.some((id) => !validSportIds.has(id))) {
      return sendJson(res, 400, { error: 'Invalid sport ids in request.' });
    }
    const selectedSportIds = new Set(sportIds);

    // Remove old sport follows and preferences for sports that were removed.
    store.follows = store.follows.filter((follow) => {
      if (follow.userId !== user.id) return true;
      if (follow.entityType === 'sport') return false;
      if (follow.entityType === 'team' || follow.entityType === 'player' || follow.entityType === 'league') {
        const sportId = getEntitySportId(store, follow.entityType, follow.entityId);
        if (!sportId) return false;
        return selectedSportIds.has(sportId);
      }
      return true;
    });

    // Re-add sport follows in provided order so newest selections appear last.
    const now = Date.now();
    sportIds.forEach((sportId, idx) => {
      store.follows.push({
        id: newId('fol'),
        userId: user.id,
        entityType: 'sport',
        entityId: sportId,
        createdAt: new Date(now + idx).toISOString(),
      });
    });
    store.userSportOrder[user.id] = [...sportIds];
    store.feedCacheBySport = {};

    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  const sportOptionsMatch = url.pathname.match(/^\/api\/sports\/([^/]+)\/interests-options$/);
  if (req.method === 'GET' && sportOptionsMatch) {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const sportId = sportOptionsMatch[1];
    const sport = store.sports.find((item) => item.id === sportId);
    if (!sport) return sendJson(res, 404, { error: 'Sport not found.' });
    const force = url.searchParams.get('refresh') === '1';
    const existing = getRealCatalogForSport(store, sportId);
    const shouldSync = force || (existing.teams.length === 0 && existing.players.length === 0 && existing.leagues.length === 0);
    let sync = { ok: true, skipped: true, reason: 'cached' };
    if (shouldSync) {
      sync = await syncSportCatalogFromSportsDb(store, sportId, {
        force: true,
        maxLeagues: 4,
        maxTeams: 40,
        maxPlayerTeams: 8,
        playersPerTeamCap: 12,
        maxDurationMs: 8000,
      });
      writeStore(store);
    }
    const interests = getUserInterests(store, user.id);
    const real = getRealCatalogForSport(store, sportId);
    return sendJson(res, 200, {
      sport,
      teams: real.teams,
      players: real.players,
      leagues: real.leagues,
      selected: {
        teamIds: interests.teamIds.filter((id) => real.teams.some((team) => team.id === id)),
        playerIds: interests.playerIds.filter((id) => real.players.some((player) => player.id === id)),
        leagueIds: interests.leagueIds.filter((id) => real.leagues.some((league) => league.id === id)),
      },
      sync,
    });
  }

  const sportInterestsMatch = url.pathname.match(/^\/api\/sports\/([^/]+)\/interests$/);
  if (req.method === 'POST' && sportInterestsMatch) {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const sportId = sportInterestsMatch[1];
    const sport = store.sports.find((item) => item.id === sportId);
    if (!sport) return sendJson(res, 404, { error: 'Sport not found.' });

    const body = await parseJsonBody(req);
    const teamIds = normalizeIdArray(body.teamIds);
    const playerIds = normalizeIdArray(body.playerIds);
    const leagueIds = normalizeIdArray(body.leagueIds);

    const real = getRealCatalogForSport(store, sportId);
    const validTeamIds = new Set(real.teams.map((team) => team.id));
    const validPlayerIds = new Set(real.players.map((player) => player.id));
    const validLeagueIds = new Set(real.leagues.map((league) => league.id));

    if (teamIds.some((id) => !validTeamIds.has(id)) || playerIds.some((id) => !validPlayerIds.has(id)) || leagueIds.some((id) => !validLeagueIds.has(id))) {
      return sendJson(res, 400, { error: 'Invalid team/player/league selection for this sport.' });
    }

    store.follows = store.follows.filter((f) => {
      if (f.userId !== user.id) return true;
      if (f.entityType === 'team') return !validTeamIds.has(f.entityId);
      if (f.entityType === 'player') return !validPlayerIds.has(f.entityId);
      if (f.entityType === 'league') return !validLeagueIds.has(f.entityId);
      return true;
    });

    upsertUserFollows(
      store,
      user.id,
      [
        ...teamIds.map((entityId) => ({ entityType: 'team', entityId })),
        ...playerIds.map((entityId) => ({ entityType: 'player', entityId })),
        ...leagueIds.map((entityId) => ({ entityType: 'league', entityId })),
      ]
    );
    delete store.feedCacheBySport[sportId];

    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/catalog/sport-requests') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await parseJsonBody(req);
    const sportName = String(body.sportName || '').trim();
    const reason = String(body.reason || '').trim();
    if (sportName.length < 2 || sportName.length > 80) {
      return sendJson(res, 400, { error: 'Sport request must be between 2 and 80 characters.' });
    }

    const normalized = normalizeName(sportName);
    const existsInCatalog = store.sports.some((sport) => normalizeName(sport.name) === normalized);
    if (existsInCatalog) {
      return sendJson(res, 409, { error: 'That sport already exists in the catalog.' });
    }

    const existingRequest = store.sportRequests.find(
      (request) => request.userId === user.id && request.normalizedName === normalized && request.status === 'pending'
    );
    if (existingRequest) {
      return sendJson(res, 200, { ok: true, request: existingRequest, deduped: true });
    }

    const request = {
      id: newId('spr'),
      userId: user.id,
      sportName,
      normalizedName: normalized,
      reason: reason.slice(0, 240),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    store.sportRequests.push(request);
    writeStore(store);
    return sendJson(res, 201, { ok: true, request });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/sport-requests') {
    if (!requireAdmin(req, res)) return;
    const requests = [...store.sportRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, { requests });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/sync-history') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { history: store.syncHistory });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/sync/sportsdb/sports') {
    if (!requireAdmin(req, res)) return;
    try {
      const data = await sportsDbGet('all_sports.php');
      const rows = Array.isArray(data?.sports) ? data.sports : [];
      let created = 0;
      rows.forEach((row) => {
        const before = store.sports.length;
        upsertSportFromSportsDb(store, row);
        if (store.sports.length > before) created += 1;
      });
      pushSyncHistory(store, { source: 'sportsdb', type: 'sports', status: 'ok', created, total: rows.length });
      writeStore(store);
      return sendJson(res, 200, { ok: true, total: rows.length, created });
    } catch (err) {
      pushSyncHistory(store, { source: 'sportsdb', type: 'sports', status: 'error', error: err.message });
      writeStore(store);
      return sendJson(res, 502, { error: `SportsDB sync failed: ${err.message}` });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/sync/sportsdb/leagues') {
    if (!requireAdmin(req, res)) return;
    try {
      const data = await sportsDbGet('all_leagues.php');
      const rows = Array.isArray(data?.leagues) ? data.leagues : [];
      let created = 0;
      rows.forEach((row) => {
        const before = store.leagues.length;
        upsertLeagueFromSportsDb(store, row);
        if (store.leagues.length > before) created += 1;
      });
      pushSyncHistory(store, { source: 'sportsdb', type: 'leagues', status: 'ok', created, total: rows.length });
      writeStore(store);
      return sendJson(res, 200, { ok: true, total: rows.length, created });
    } catch (err) {
      pushSyncHistory(store, { source: 'sportsdb', type: 'leagues', status: 'error', error: err.message });
      writeStore(store);
      return sendJson(res, 502, { error: `SportsDB league sync failed: ${err.message}` });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/sync/sportsdb/catalog') {
    if (!requireAdmin(req, res)) return;
    const body = await parseJsonBody(req);
    const sportId = String(body.sportId || '').trim();
    if (!sportId) return sendJson(res, 400, { error: 'sportId is required.' });
    const sport = store.sports.find((item) => item.id === sportId);
    if (!sport) return sendJson(res, 404, { error: 'Sport not found.' });

    const maxTeams = Number(body.maxTeams);
    const maxLeagues = Number(body.maxLeagues);
    const playersPerTeamCap = Number(body.playersPerTeamCap);
    const maxPlayerTeams = Number(body.maxPlayerTeams);
    const maxDurationMs = Number(body.maxDurationMs);
    const sync = await syncSportCatalogFromSportsDb(store, sport.id, {
      force: true,
      maxTeams: Number.isFinite(maxTeams) ? Math.max(1, Math.min(200, maxTeams)) : undefined,
      maxLeagues: Number.isFinite(maxLeagues) ? Math.max(1, Math.min(20, maxLeagues)) : undefined,
      playersPerTeamCap: Number.isFinite(playersPerTeamCap)
        ? Math.max(1, Math.min(50, playersPerTeamCap))
        : undefined,
      maxPlayerTeams: Number.isFinite(maxPlayerTeams) ? Math.max(1, Math.min(60, maxPlayerTeams)) : undefined,
      maxDurationMs: Number.isFinite(maxDurationMs) ? Math.max(2000, Math.min(25000, maxDurationMs)) : undefined,
    });
    writeStore(store);
    if (!sync.ok && sync.reason === 'provider_error') {
      return sendJson(res, 502, { error: `SportsDB catalog sync failed: ${sync.error}` });
    }
    return sendJson(res, 200, { ok: true, sportId, ...sync });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/catalog/upsert') {
    if (!requireAdmin(req, res)) return;
    const body = await parseJsonBody(req);
    const sportId = String(body.sportId || '').trim();
    const teams = Array.isArray(body.teams) ? body.teams : [];
    const players = Array.isArray(body.players) ? body.players : [];

    if (!sportId) {
      return sendJson(res, 400, { error: 'sportId is required.' });
    }

    const sport = store.sports.find((item) => item.id === sportId);
    if (!sport) {
      return sendJson(res, 404, { error: 'Sport not found in catalog.' });
    }

    let createdTeams = 0;
    let createdPlayers = 0;
    const teamIndexByNormalizedName = new Map(
      store.teams
        .filter((team) => team.sportId === sportId)
        .map((team) => [normalizeName(team.name), team])
    );

    for (const teamInput of teams) {
      const teamName = String((teamInput && teamInput.name) || '').trim();
      if (teamName.length < 2) continue;

      const normalizedTeamName = normalizeName(teamName);
      if (teamIndexByNormalizedName.has(normalizedTeamName)) continue;

      const team = {
        id: newId('tm'),
        sportId,
        name: teamName,
        slug: teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      };
      store.teams.push(team);
      teamIndexByNormalizedName.set(normalizedTeamName, team);
      createdTeams += 1;
    }

    for (const playerInput of players) {
      const playerName = String((playerInput && playerInput.name) || '').trim();
      if (playerName.length < 2) continue;

      const normalizedPlayerName = normalizeName(playerName);
      const exists = store.players.some(
        (player) => player.sportId === sportId && normalizeName(player.name) === normalizedPlayerName
      );
      if (exists) continue;

      const teamName = String((playerInput && playerInput.teamName) || '').trim();
      let teamId = null;
      if (teamName) {
        const match = teamIndexByNormalizedName.get(normalizeName(teamName));
        teamId = match ? match.id : null;
      }

      store.players.push({
        id: newId('pl'),
        sportId,
        teamId,
        name: playerName,
      });
      createdPlayers += 1;
    }

    writeStore(store);
    return sendJson(res, 200, { ok: true, sportId, createdTeams, createdPlayers });
  }

  if (req.method === 'POST' && url.pathname === '/api/onboarding/interests') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await parseJsonBody(req);
    const sportIds = normalizeIdArray(body.sportIds);
    const teamIds = normalizeIdArray(body.teamIds);
    const playerIds = normalizeIdArray(body.playerIds);
    const leagueIds = normalizeIdArray(body.leagueIds);

    if (sportIds.length === 0) {
      return sendJson(res, 400, { error: 'Select at least one sport.' });
    }

    const validSportIds = new Set(store.sports.map((s) => s.id));
    const validTeamIds = new Set(store.teams.map((t) => t.id));
    const validPlayerIds = new Set(store.players.map((p) => p.id));
    const validLeagueIds = new Set(store.leagues.map((l) => l.id));

    const invalidIds = [
      ...sportIds.filter((id) => !validSportIds.has(id)),
      ...teamIds.filter((id) => !validTeamIds.has(id)),
      ...playerIds.filter((id) => !validPlayerIds.has(id)),
      ...leagueIds.filter((id) => !validLeagueIds.has(id)),
    ];

    if (invalidIds.length > 0) {
      return sendJson(res, 400, { error: 'Invalid interest ids in request.' });
    }

    const selectedSportIds = new Set(sportIds);
    const invalidTeamScope = store.teams.some((team) => teamIds.includes(team.id) && !selectedSportIds.has(team.sportId));
    const invalidPlayerScope = store.players.some((player) => playerIds.includes(player.id) && !selectedSportIds.has(player.sportId));
    const invalidLeagueScope = store.leagues.some((league) => leagueIds.includes(league.id) && !selectedSportIds.has(league.sportId));
    if (invalidTeamScope || invalidPlayerScope || invalidLeagueScope) {
      return sendJson(res, 400, { error: 'Teams, players, and leagues must belong to selected sports.' });
    }

    store.follows = store.follows.filter((f) => f.userId !== user.id);
    const now = new Date().toISOString();

    for (const sportId of sportIds) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'sport', entityId: sportId, createdAt: now });
    }
    for (const teamId of teamIds) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'team', entityId: teamId, createdAt: now });
    }
    for (const playerId of playerIds) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'player', entityId: playerId, createdAt: now });
    }
    for (const leagueId of leagueIds) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'league', entityId: leagueId, createdAt: now });
    }
    store.userSportOrder[user.id] = [...sportIds];
    store.feedCacheBySport = {};

    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/me/interests') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, getUserInterests(store, user.id));
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    const filePath = staticFilePath(url.pathname);
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    const status = err.message === 'Invalid JSON' || err.message === 'Payload too large' ? 400 : 500;
    return sendJson(res, status, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Sports One listening on http://localhost:${PORT}`);
});
