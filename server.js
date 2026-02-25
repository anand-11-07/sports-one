const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function readStore() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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
  }));
}

async function handleApi(req, res, url) {
  const store = readStore();

  if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
    const body = await parseJsonBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();

    if (!email || !password || password.length < 8) {
      return sendJson(res, 400, { error: 'Valid email and 8+ char password are required.' });
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

    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/`);
    return sendJson(res, 201, {
      user: { id: user.id, email: user.email, name: user.name },
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await parseJsonBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');

    const user = store.users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'Invalid credentials.' });
    }

    const sid = newId('sid');
    store.sessions.push({ id: sid, userId: user.id, createdAt: new Date().toISOString() });
    writeStore(store);

    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/`);
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

  if (req.method === 'POST' && url.pathname === '/api/onboarding/interests') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await parseJsonBody(req);
    const sportIds = Array.isArray(body.sportIds) ? body.sportIds : [];
    const teamIds = Array.isArray(body.teamIds) ? body.teamIds : [];
    const playerIds = Array.isArray(body.playerIds) ? body.playerIds : [];

    if (sportIds.length === 0) {
      return sendJson(res, 400, { error: 'Select at least one sport.' });
    }

    const validSportIds = new Set(store.sports.map((s) => s.id));
    const validTeamIds = new Set(store.teams.map((t) => t.id));
    const validPlayerIds = new Set(store.players.map((p) => p.id));

    const invalid = [
      ...sportIds.filter((id) => !validSportIds.has(id)),
      ...teamIds.filter((id) => !validTeamIds.has(id)),
      ...playerIds.filter((id) => !validPlayerIds.has(id)),
    ];

    if (invalid.length > 0) {
      return sendJson(res, 400, { error: 'Invalid interest ids in request.' });
    }

    store.follows = store.follows.filter((f) => f.userId !== user.id);
    const now = new Date().toISOString();

    for (const sportId of new Set(sportIds)) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'sport', entityId: sportId, createdAt: now });
    }
    for (const teamId of new Set(teamIds)) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'team', entityId: teamId, createdAt: now });
    }
    for (const playerId of new Set(playerIds)) {
      store.follows.push({ id: newId('fol'), userId: user.id, entityType: 'player', entityId: playerId, createdAt: now });
    }

    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/me/interests') {
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

    const follows = store.follows.filter((f) => f.userId === user.id);
    const sportIds = follows.filter((f) => f.entityType === 'sport').map((f) => f.entityId);
    const teamIds = follows.filter((f) => f.entityType === 'team').map((f) => f.entityId);
    const playerIds = follows.filter((f) => f.entityType === 'player').map((f) => f.entityId);

    return sendJson(res, 200, { sportIds, teamIds, playerIds });
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
