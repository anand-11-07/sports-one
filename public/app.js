const state = {
  mode: 'signup',
  options: [],
  catalogSports: [],
  selectedSports: new Set(),
  selectedTeams: new Set(),
  selectedPlayers: new Set(),
  selectedLeagues: new Set(),
  user: null,
  busy: false,
  searchTimer: null,
  homeSections: [],
  homeOffset: 0,
  homeBatchSize: 3,
  homeObserver: null,
  activeSportEditor: null,
  messageTimer: null,
  sportsFlowMode: 'onboarding',
};

const screens = [
  'screen-welcome',
  'screen-auth',
  'screen-sports',
  'screen-review',
  'screen-home',
  'screen-sport-interests',
  'screen-account',
  'screen-sport-request',
];

function $(id) {
  return document.getElementById(id);
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  document.querySelectorAll('button, input').forEach((element) => {
    if (element.id === 'message') return;
    element.disabled = nextBusy;
  });
}

function dismissMessageWithFade() {
  const box = $('message');
  if (box.classList.contains('hidden')) return;
  box.classList.add('fading');
  window.setTimeout(() => {
    box.classList.add('hidden');
    box.classList.remove('fading');
    box.textContent = '';
    box.classList.remove('error');
  }, 280);
}

function showMessage(message, isError = false) {
  const box = $('message');
  if (state.messageTimer) {
    window.clearTimeout(state.messageTimer);
    state.messageTimer = null;
  }
  box.textContent = message;
  box.classList.remove('hidden');
  box.classList.remove('fading');
  box.classList.toggle('error', isError);

  if (!isError) {
    state.messageTimer = window.setTimeout(() => {
      dismissMessageWithFade();
      state.messageTimer = null;
    }, 2200);
  }
}

function clearMessage() {
  if (state.messageTimer) {
    window.clearTimeout(state.messageTimer);
    state.messageTimer = null;
  }
  const box = $('message');
  box.textContent = '';
  box.classList.add('hidden');
  box.classList.remove('fading');
  box.classList.remove('error');
}

function showScreen(id) {
  screens.forEach((screenId) => {
    $(screenId).classList.toggle('hidden', screenId !== id);
  });
}

function setUserPill() {
  const pill = $('user-pill');
  if (state.user) {
    pill.textContent = `Signed in as ${state.user.name} (${state.user.email})`;
    pill.classList.remove('hidden');
  } else {
    pill.textContent = '';
    pill.classList.add('hidden');
  }
}

function setSportsFlowMode(mode) {
  state.sportsFlowMode = mode;
  const cta = document.querySelector('#screen-sports [data-action="to-review"]');
  if (!cta) return;
  cta.textContent = mode === 'edit' ? 'Save sports' : 'Continue';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setAuthMode(mode) {
  state.mode = mode;
  $('auth-title').textContent = mode === 'signup' ? 'Sign Up' : 'Log In';
  $('auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('name').parentElement.style.display = mode === 'signup' ? 'grid' : 'none';
}

function validateAuthPayload(payload) {
  const email = String(payload.email || '').trim();
  const password = String(payload.password || '');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 'Please enter a valid email address.';
  if (state.mode === 'signup') {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return 'Password must be 8+ chars and include at least 1 letter and 1 number.';
    }
  }
  if (state.mode === 'login' && password.length === 0) return 'Password is required.';
  return '';
}

function getSportMap() {
  return new Map(state.options.map((sport) => [sport.id, sport]));
}

function getScopedEntityIdsForSelectedSports() {
  const selectedSportIds = new Set(state.selectedSports);
  const validTeamIds = new Set();
  const validPlayerIds = new Set();
  const validLeagueIds = new Set();

  state.options.forEach((sport) => {
    if (!selectedSportIds.has(sport.id)) return;
    (sport.teams || []).forEach((team) => validTeamIds.add(team.id));
    (sport.players || []).forEach((player) => validPlayerIds.add(player.id));
    (sport.leagues || []).forEach((league) => validLeagueIds.add(league.id));
  });

  return {
    teamIds: [...state.selectedTeams].filter((id) => validTeamIds.has(id)),
    playerIds: [...state.selectedPlayers].filter((id) => validPlayerIds.has(id)),
    leagueIds: [...state.selectedLeagues].filter((id) => validLeagueIds.has(id)),
  };
}

function renderSelectedCount() {
  $('selected-count').textContent = `${state.selectedSports.size} selected`;
}

function renderSelectedSection(query) {
  const section = $('selected-section');
  const list = $('selected-list');
  const sportMap = getSportMap();
  const selected = [...state.selectedSports]
    .map((id) => sportMap.get(id))
    .filter(Boolean);

  if (query || selected.length === 0) {
    section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = '';
  selected.forEach((sport) => {
    const button = document.createElement('button');
    button.className = 'chip active';
    button.type = 'button';
    button.textContent = sport.name;
    button.dataset.action = 'toggle-sport';
    button.dataset.sportId = sport.id;
    list.appendChild(button);
  });
}

async function toggleSportSelectionById(sportId) {
  const hadSearchQuery = $('sport-search').value.trim().length > 0;
  if (state.selectedSports.has(sportId)) state.selectedSports.delete(sportId);
  else state.selectedSports.add(sportId);

  if (hadSearchQuery) {
    $('sport-search').value = '';
    await loadCatalog('');
  } else {
    renderSportsCatalog();
  }
}

function renderSportsCatalog() {
  const container = $('sports-list');
  const empty = $('sports-empty');
  const query = $('sport-search').value.trim();
  const displaySports = query
    ? state.catalogSports
    : state.catalogSports.filter((sport) => !state.selectedSports.has(sport.id));

  renderSelectedCount();
  renderSelectedSection(query);
  container.innerHTML = '';

  if (displaySports.length === 0) {
    empty.classList.remove('hidden');
    empty.textContent = query
      ? `No sports found for "${query}". Use "Can't find your sport?" to request it.`
      : 'No sports available right now.';
    return;
  }

  empty.classList.add('hidden');
  displaySports.forEach((sport) => {
    const button = document.createElement('button');
    button.className = `chip ${state.selectedSports.has(sport.id) ? 'active' : ''}`;
    button.type = 'button';
    button.textContent = sport.name;
    button.dataset.action = 'toggle-sport';
    button.dataset.sportId = sport.id;
    container.appendChild(button);
  });
}

function renderReview(targetId) {
  const sportMap = getSportMap();
  const sports = [...state.selectedSports]
    .map((id) => sportMap.get(id)?.name)
    .filter(Boolean);
  const target = $(targetId);
  const chips = sports.length
    ? sports.map((name) => `<span class="summary-pill">${name}</span>`).join('')
    : '<span class="summary-empty">No sports selected</span>';

  target.innerHTML = `
    <div class="summary-block">
      <p class="summary-label">Sports</p>
      <div class="summary-pills">${chips}</div>
    </div>
  `;
}

async function loadOptions() {
  const data = await api('/api/onboarding/options');
  state.options = data.sports;
}

async function loadCatalog(query = '') {
  const trimmed = query.trim();
  const limit = trimmed ? 40 : 16;
  const data = await api(`/api/catalog/sports?q=${encodeURIComponent(trimmed)}&limit=${limit}`);
  state.catalogSports = data.sports || [];
  renderSportsCatalog();
}

async function loadSavedInterests() {
  const data = await api('/api/me/interests');
  state.selectedSports = new Set(data.sportIds || []);
  state.selectedTeams = new Set(data.teamIds || []);
  state.selectedPlayers = new Set(data.playerIds || []);
  state.selectedLeagues = new Set(data.leagueIds || []);
}

function disconnectHomeObserver() {
  if (state.homeObserver) {
    state.homeObserver.disconnect();
    state.homeObserver = null;
  }
}

function renderHomeSectionsChunk() {
  const feed = $('home-feed');
  const sentinel = $('home-feed-sentinel');
  const end = Math.min(state.homeOffset + state.homeBatchSize, state.homeSections.length);

  for (let i = state.homeOffset; i < end; i += 1) {
    const section = state.homeSections[i];
    const highlights = Array.isArray(section.highlights) ? section.highlights : [];
    const news = Array.isArray(section.news) ? section.news : [];
    const highlightsHtml = highlights.length
      ? `<div class="highlight-list">${highlights
          .map(
            (item) => `<article class="highlight-item">
              <p class="highlight-title">${item.title || 'Upcoming event'}</p>
              <p class="highlight-meta">${item.league || ''}${item.date ? ` · ${item.date}` : ''}${item.time ? ` ${item.time}` : ''}</p>
            </article>`
          )
          .join('')}</div>`
      : '';
    const newsHtml = news.length
      ? `<div class="news-list">${news
          .map(
            (item) => `<article class="news-item">
              <p class="news-title">${item.title || 'Latest update'}</p>
              <p class="news-meta">${item.date || ''}</p>
            </article>`
          )
          .join('')}</div>`
      : '<p class="muted">Live updates are syncing for your selected interests.</p>';
    const card = document.createElement('article');
    card.className = 'sport-feed-card';
    card.innerHTML = `
      <div class="sport-feed-head">
        <h3>${section.sport.name}</h3>
        <button class="secondary" data-action="open-sport-interests" data-sport-id="${section.sport.id}">Add interests</button>
      </div>
      <div class="sport-feed-metrics">
        <span class="metric-pill">${section.counts.teams} teams</span>
        <span class="metric-pill">${section.counts.players} players</span>
        <span class="metric-pill">${section.counts.leagues} leagues</span>
      </div>
      <p class="muted">Track favorites for ${section.sport.name} in one place.</p>      
      ${highlights.length ? '<p class="feed-block-title">Matches & Fixtures</p>' : ''}
      ${highlightsHtml}
      <p class="feed-block-title">Latest News</p>
      ${newsHtml}
    `;
    feed.appendChild(card);
  }

  state.homeOffset = end;
  const done = state.homeOffset >= state.homeSections.length;
  sentinel.classList.toggle('hidden', done);
  sentinel.textContent = done ? 'All followed sports loaded.' : 'Loading more sports sections...';
}

function setupHomeObserver() {
  disconnectHomeObserver();
  const sentinel = $('home-feed-sentinel');
  if (state.homeOffset >= state.homeSections.length) {
    sentinel.classList.add('hidden');
    return;
  }

  sentinel.classList.remove('hidden');
  state.homeObserver = new IntersectionObserver((entries) => {
    const hit = entries.some((entry) => entry.isIntersecting);
    if (!hit) return;
    renderHomeSectionsChunk();
  }, { threshold: 0.2 });

  state.homeObserver.observe(sentinel);
}

async function loadHomeFeed() {
  const data = await api('/api/home/feed');
  state.homeSections = data.sections || [];
  state.homeOffset = 0;

  const feed = $('home-feed');
  const empty = $('home-feed-empty');
  feed.innerHTML = '';

  if (state.homeSections.length === 0) {
    empty.classList.remove('hidden');
    $('home-feed-sentinel').classList.add('hidden');
    disconnectHomeObserver();
    return;
  }

  empty.classList.add('hidden');
  renderHomeSectionsChunk();
  setupHomeObserver();
}

async function renderAccount() {
  const interests = await api('/api/me/interests');
  const summary = $('account-summary');
  summary.innerHTML = `
    <div class="summary-block">
      <p class="summary-label">Profile</p>
      <div class="summary-pills"><span class="summary-pill">${state.user.name}</span><span class="summary-pill">${state.user.email}</span></div>
      <p class="summary-label">Interests</p>
      <div class="summary-pills">
        <span class="summary-pill">${(interests.sportIds || []).length} sports</span>
        <span class="summary-pill">${(interests.teamIds || []).length} teams</span>
        <span class="summary-pill">${(interests.playerIds || []).length} players</span>
        <span class="summary-pill">${(interests.leagueIds || []).length} leagues</span>
      </div>
    </div>
  `;
}

function renderSportInterestGroups(data) {
  const wrap = $('sport-interest-groups');
  wrap.innerHTML = '';

  const groups = [
    { key: 'teams', label: 'Teams', selected: state.activeSportEditor.teamIds, items: Array.isArray(data.teams) ? data.teams : [] },
    { key: 'players', label: 'Players', selected: state.activeSportEditor.playerIds, items: Array.isArray(data.players) ? data.players : [] },
    { key: 'leagues', label: 'Leagues', selected: state.activeSportEditor.leagueIds, items: Array.isArray(data.leagues) ? data.leagues : [] },
  ];

  groups.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'interest-group';
    const itemHtml = group.items.length
      ? `<div class="interest-chip-grid">${group.items
          .map(
            (item) =>
              `<button type="button" class="interest-chip ${group.selected.has(item.id) ? 'selected' : ''}" data-action="toggle-interest-option" data-group="${group.key}" data-id="${item.id}">${item.name}</button>`
          )
          .join('')}</div>`
      : '<p class="muted">No options yet for this sport.</p>';

    section.innerHTML = `
      <h3>${group.label}</h3>
      ${itemHtml}
    `;

    wrap.appendChild(section);
  });
}

async function openSportInterestEditor(sportId) {
  const data = await api(`/api/sports/${sportId}/interests-options`);
  state.activeSportEditor = {
    sportId,
    teamIds: new Set(data.selected.teamIds || []),
    playerIds: new Set(data.selected.playerIds || []),
    leagueIds: new Set(data.selected.leagueIds || []),
  };
  $('sport-interests-title').textContent = `${data.sport.name} Interests`;
  renderSportInterestGroups(data);
  showScreen('screen-sport-interests');
}

async function saveSportInterestEditor() {
  if (!state.activeSportEditor) return;

  const teamIds = [...state.activeSportEditor.teamIds];
  const playerIds = [...state.activeSportEditor.playerIds];
  const leagueIds = [...state.activeSportEditor.leagueIds];

  await api(`/api/sports/${state.activeSportEditor.sportId}/interests`, {
    method: 'POST',
    body: JSON.stringify({ teamIds, playerIds, leagueIds }),
  });

  await loadSavedInterests();
  await loadHomeFeed();
  showScreen('screen-home');
  showMessage('Sport interests saved.');
}

async function saveSportsSelection() {
  if (state.selectedSports.size === 0) {
    showMessage('Please select at least one sport.', true);
    return false;
  }

  const payload = {
    sportIds: [...state.selectedSports],
  };

  try {
    await api('/api/me/sports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Backward-compatible fallback for older running backend instances
    // that don't yet expose /api/me/sports.
    if (String(err.message || '').toLowerCase() !== 'not found') {
      throw err;
    }
    const scoped = getScopedEntityIdsForSelectedSports();
    await api('/api/onboarding/interests', {
      // Keep only entities that belong to still-selected sports, so de-selecting
      // a sport never fails due to stale team/player/league ids.
      method: 'POST',
      body: JSON.stringify({
        sportIds: payload.sportIds,
        teamIds: scoped.teamIds,
        playerIds: scoped.playerIds,
        leagueIds: scoped.leagueIds,
      }),
    });
  }

  await loadSavedInterests();
  await loadHomeFeed();
  showScreen('screen-home');
  showMessage('Sports preferences saved.');
  return true;
}

async function hydrateUser() {
  clearMessage();
  try {
    setBusy(true);
    const me = await api('/api/me');
    state.user = me.user;
    setUserPill();

    await loadOptions();
    await loadSavedInterests();

    if (state.selectedSports.size > 0) {
      await loadHomeFeed();
      showScreen('screen-home');
    } else {
      setSportsFlowMode('onboarding');
      await loadCatalog('');
      showScreen('screen-sports');
    }
  } catch (_) {
    state.user = null;
    setUserPill();
    showScreen('screen-welcome');
  } finally {
    setBusy(false);
  }
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  clearMessage();

  const payload = {
    name: $('name').value.trim(),
    email: $('email').value.trim(),
    password: $('password').value,
  };

  const validationError = validateAuthPayload(payload);
  if (validationError) return showMessage(validationError, true);

  try {
    setBusy(true);
    const path = state.mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const result = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    state.user = result.user;
    setUserPill();
    await loadOptions();
    await loadSavedInterests();

    if (state.selectedSports.size > 0) {
      await loadHomeFeed();
      showScreen('screen-home');
      showMessage('Welcome back.');
    } else {
      setSportsFlowMode('onboarding');
      $('sport-search').value = '';
      await loadCatalog('');
      showScreen('screen-sports');
      showMessage(state.mode === 'signup' ? 'Account created. Select your sports.' : 'Welcome back. Continue onboarding.');
    }
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    setBusy(false);
  }
});

$('sport-search').addEventListener('input', () => {
  clearMessage();
  const query = $('sport-search').value;
  if (state.searchTimer) clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(async () => {
    if (!state.user || state.busy) return;
    try {
      await loadCatalog(query);
    } catch (err) {
      showMessage(err.message, true);
    }
  }, 250);
});

$('sport-request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const sportName = $('sport-request-name').value.trim();
  const reason = $('sport-request-reason').value.trim();

  if (sportName.length < 2) return showMessage('Sport request must be at least 2 characters.', true);

  try {
    setBusy(true);
    await api('/api/catalog/sport-requests', {
      method: 'POST',
      body: JSON.stringify({ sportName, reason }),
    });
    $('sport-request-form').reset();
    $('sport-search').value = '';
    await loadCatalog('');
    showScreen('screen-sports');
    showMessage('Sport request submitted.');
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    setBusy(false);
  }
});

document.addEventListener('click', async (event) => {
  const action = event.target.getAttribute('data-action');
  if (!action || state.busy) return;
  clearMessage();

  try {
    if (action === 'show-signup') {
      setAuthMode('signup');
      return showScreen('screen-auth');
    }
    if (action === 'show-login') {
      setAuthMode('login');
      return showScreen('screen-auth');
    }
    if (action === 'go-back') return showScreen('screen-welcome');
    if (action === 'open-sport-request') {
      $('sport-request-name').value = $('sport-search').value.trim();
      return showScreen('screen-sport-request');
    }
    if (action === 'back-to-sports-from-request') return showScreen('screen-sports');

    if (action === 'toggle-sport') {
      const sportId = event.target.getAttribute('data-sport-id');
      if (sportId) await toggleSportSelectionById(sportId);
      return;
    }

    if (action === 'toggle-interest-option') {
      if (!state.activeSportEditor) return;
      const group = event.target.getAttribute('data-group');
      const id = event.target.getAttribute('data-id');
      if (!group || !id) return;
      const map = {
        teams: state.activeSportEditor.teamIds,
        players: state.activeSportEditor.playerIds,
        leagues: state.activeSportEditor.leagueIds,
      };
      const selected = map[group];
      if (!selected) return;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      event.target.classList.toggle('selected', selected.has(id));
      return;
    }

    if (action === 'back-to-sports') {
      await loadCatalog($('sport-search').value || '');
      return showScreen('screen-sports');
    }

    if (action === 'to-review') {
      if (state.selectedSports.size === 0) return showMessage('Please select at least one sport.', true);
      if (state.sportsFlowMode === 'edit') {
        setBusy(true);
        await saveSportsSelection();
        return;
      }
      renderReview('review-content');
      return showScreen('screen-review');
    }

    if (action === 'save-interests') {
      setBusy(true);
      await saveSportsSelection();
      return;
    }

    if (action === 'open-sport-interests') {
      const sportId = event.target.getAttribute('data-sport-id');
      if (!sportId) return;
      setBusy(true);
      return await openSportInterestEditor(sportId);
    }

    if (action === 'save-sport-interests') {
      setBusy(true);
      return await saveSportInterestEditor();
    }

    if (action === 'cancel-sport-interests') {
      showScreen('screen-home');
      return;
    }

    if (action === 'go-account') {
      setBusy(true);
      await renderAccount();
      return showScreen('screen-account');
    }

    if (action === 'back-home') {
      await loadHomeFeed();
      return showScreen('screen-home');
    }

    if (action === 'edit-interests') {
      setSportsFlowMode('edit');
      $('sport-search').value = '';
      await loadCatalog('');
      return showScreen('screen-sports');
    }

    if (action === 'logout') {
      setBusy(true);
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (_) {
        // ignore
      }

      disconnectHomeObserver();
      state.user = null;
      state.selectedSports.clear();
      state.selectedTeams.clear();
      state.selectedPlayers.clear();
      state.selectedLeagues.clear();
      state.options = [];
      state.catalogSports = [];
      state.homeSections = [];
      $('auth-form').reset();
      $('sport-search').value = '';
      $('sport-request-form').reset();
      setUserPill();
      showScreen('screen-welcome');
      return showMessage('Logged out.');
    }
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    setBusy(false);
  }
});

hydrateUser();
