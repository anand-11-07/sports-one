const state = {
  mode: 'signup',
  options: [],
  selectedSports: new Set(),
  selectedTeams: new Set(),
  selectedPlayers: new Set(),
  user: null,
};

const screens = [
  'screen-welcome',
  'screen-auth',
  'screen-sports',
  'screen-favorites',
  'screen-review',
  'screen-home',
];

function $(id) {
  return document.getElementById(id);
}

function showMessage(message, isError = false) {
  const box = $('message');
  box.textContent = message;
  box.classList.remove('hidden');
  box.classList.toggle('error', isError);
}

function clearMessage() {
  const box = $('message');
  box.textContent = '';
  box.classList.add('hidden');
  box.classList.remove('error');
}

function showScreen(id) {
  screens.forEach((screenId) => {
    $(screenId).classList.toggle('hidden', screenId !== id);
  });
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
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function setAuthMode(mode) {
  state.mode = mode;
  $('auth-title').textContent = mode === 'signup' ? 'Sign Up' : 'Log In';
  $('auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('name').parentElement.style.display = mode === 'signup' ? 'grid' : 'none';
}

function renderSports() {
  const container = $('sports-list');
  container.innerHTML = '';

  state.options.forEach((sport) => {
    const btn = document.createElement('button');
    btn.className = `chip ${state.selectedSports.has(sport.id) ? 'active' : ''}`;
    btn.textContent = sport.name;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (state.selectedSports.has(sport.id)) {
        state.selectedSports.delete(sport.id);
        sport.teams.forEach((t) => state.selectedTeams.delete(t.id));
        sport.players.forEach((p) => state.selectedPlayers.delete(p.id));
      } else {
        state.selectedSports.add(sport.id);
      }
      renderSports();
    });
    container.appendChild(btn);
  });
}

function renderFavorites() {
  const wrap = $('favorites-wrap');
  wrap.innerHTML = '';

  const selectedSports = state.options.filter((sport) => state.selectedSports.has(sport.id));

  if (selectedSports.length === 0) {
    wrap.innerHTML = '<p>Select at least one sport first.</p>';
    return;
  }

  selectedSports.forEach((sport) => {
    const section = document.createElement('section');
    section.className = 'group';

    const title = document.createElement('h3');
    title.textContent = sport.name;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'group-grid';

    const teamsCard = document.createElement('div');
    teamsCard.innerHTML = '<strong>Teams</strong>';
    sport.teams.forEach((team) => {
      const label = document.createElement('label');
      label.className = 'item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.selectedTeams.has(team.id);
      input.addEventListener('change', () => {
        if (input.checked) state.selectedTeams.add(team.id);
        else state.selectedTeams.delete(team.id);
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(team.name));
      teamsCard.appendChild(label);
    });

    const playersCard = document.createElement('div');
    playersCard.innerHTML = '<strong>Players</strong>';
    sport.players.forEach((player) => {
      const label = document.createElement('label');
      label.className = 'item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.selectedPlayers.has(player.id);
      input.addEventListener('change', () => {
        if (input.checked) state.selectedPlayers.add(player.id);
        else state.selectedPlayers.delete(player.id);
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(player.name));
      playersCard.appendChild(label);
    });

    grid.appendChild(teamsCard);
    grid.appendChild(playersCard);
    section.appendChild(grid);
    wrap.appendChild(section);
  });
}

function entityNames() {
  const selectedSports = state.options.filter((s) => state.selectedSports.has(s.id)).map((s) => s.name);
  const teamMap = new Map(state.options.flatMap((s) => s.teams.map((t) => [t.id, t.name])));
  const playerMap = new Map(state.options.flatMap((s) => s.players.map((p) => [p.id, p.name])));

  return {
    sports: selectedSports,
    teams: [...state.selectedTeams].map((id) => teamMap.get(id)).filter(Boolean),
    players: [...state.selectedPlayers].map((id) => playerMap.get(id)).filter(Boolean),
  };
}

function renderReview(targetId) {
  const { sports, teams, players } = entityNames();
  const target = $(targetId);
  target.innerHTML = `
    <strong>Sports:</strong>
    <ul>${sports.map((n) => `<li>${n}</li>`).join('') || '<li>None</li>'}</ul>
    <strong>Teams:</strong>
    <ul>${teams.map((n) => `<li>${n}</li>`).join('') || '<li>None</li>'}</ul>
    <strong>Players:</strong>
    <ul>${players.map((n) => `<li>${n}</li>`).join('') || '<li>None</li>'}</ul>
  `;
}

async function loadOptions() {
  const data = await api('/api/onboarding/options');
  state.options = data.sports;
  renderSports();
}

async function hydrateUser() {
  try {
    const me = await api('/api/me');
    state.user = me.user;

    await loadOptions();

    const interests = await api('/api/me/interests');
    state.selectedSports = new Set(interests.sportIds || []);
    state.selectedTeams = new Set(interests.teamIds || []);
    state.selectedPlayers = new Set(interests.playerIds || []);

    if (state.selectedSports.size > 0) {
      renderReview('saved-summary');
      showScreen('screen-home');
    } else {
      renderSports();
      showScreen('screen-sports');
    }
  } catch (_) {
    state.user = null;
    showScreen('screen-welcome');
  }
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  const payload = {
    name: $('name').value,
    email: $('email').value,
    password: $('password').value,
  };

  try {
    const path = state.mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    await api(path, { method: 'POST', body: JSON.stringify(payload) });
    await loadOptions();
    showScreen('screen-sports');
  } catch (err) {
    showMessage(err.message, true);
  }
});

document.addEventListener('click', async (event) => {
  const action = event.target.getAttribute('data-action');
  if (!action) return;

  clearMessage();

  if (action === 'show-signup') {
    setAuthMode('signup');
    showScreen('screen-auth');
  }

  if (action === 'show-login') {
    setAuthMode('login');
    showScreen('screen-auth');
  }

  if (action === 'go-back') {
    showScreen('screen-welcome');
  }

  if (action === 'to-favorites') {
    if (state.selectedSports.size === 0) {
      showMessage('Please select at least one sport.', true);
      return;
    }
    renderFavorites();
    showScreen('screen-favorites');
  }

  if (action === 'back-to-sports') {
    renderSports();
    showScreen('screen-sports');
  }

  if (action === 'to-review') {
    renderReview('review-content');
    showScreen('screen-review');
  }

  if (action === 'back-to-favorites') {
    renderFavorites();
    showScreen('screen-favorites');
  }

  if (action === 'save-interests') {
    try {
      await api('/api/onboarding/interests', {
        method: 'POST',
        body: JSON.stringify({
          sportIds: [...state.selectedSports],
          teamIds: [...state.selectedTeams],
          playerIds: [...state.selectedPlayers],
        }),
      });
      renderReview('saved-summary');
      showScreen('screen-home');
      showMessage('Onboarding completed successfully.');
    } catch (err) {
      showMessage(err.message, true);
    }
  }

  if (action === 'logout') {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // Ignore logout errors and reset UI.
    }
    state.selectedSports.clear();
    state.selectedTeams.clear();
    state.selectedPlayers.clear();
    state.options = [];
    $('auth-form').reset();
    showScreen('screen-welcome');
    showMessage('Logged out.');
  }
});

hydrateUser();
