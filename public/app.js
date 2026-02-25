const state = {
  mode: 'signup',
  options: [],
  selectedSports: new Set(),
  selectedTeams: new Set(),
  selectedPlayers: new Set(),
  user: null,
  busy: false,
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

function setBusy(nextBusy) {
  state.busy = nextBusy;
  document.querySelectorAll('button, input').forEach((element) => {
    if (element.id === 'message') return;
    element.disabled = nextBusy;
  });
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

function validateAuthPayload(payload) {
  const email = String(payload.email || '').trim();
  const password = String(payload.password || '');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return 'Please enter a valid email address.';
  }

  if (state.mode === 'signup') {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return 'Password must be 8+ chars and include at least 1 letter and 1 number.';
    }
  }

  if (state.mode === 'login' && password.length === 0) {
    return 'Password is required.';
  }

  return '';
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
        sport.teams.forEach((team) => state.selectedTeams.delete(team.id));
        sport.players.forEach((player) => state.selectedPlayers.delete(player.id));
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
  const sports = state.options.filter((sport) => state.selectedSports.has(sport.id)).map((sport) => sport.name);
  const teamMap = new Map(state.options.flatMap((sport) => sport.teams.map((team) => [team.id, team.name])));
  const playerMap = new Map(state.options.flatMap((sport) => sport.players.map((player) => [player.id, player.name])));

  return {
    sports,
    teams: [...state.selectedTeams].map((id) => teamMap.get(id)).filter(Boolean),
    players: [...state.selectedPlayers].map((id) => playerMap.get(id)).filter(Boolean),
  };
}

function renderReview(targetId) {
  const { sports, teams, players } = entityNames();
  const target = $(targetId);
  target.innerHTML = `
    <strong>Sports:</strong>
    <ul>${sports.map((name) => `<li>${name}</li>`).join('') || '<li>None</li>'}</ul>
    <strong>Teams:</strong>
    <ul>${teams.map((name) => `<li>${name}</li>`).join('') || '<li>None</li>'}</ul>
    <strong>Players:</strong>
    <ul>${players.map((name) => `<li>${name}</li>`).join('') || '<li>None</li>'}</ul>
  `;
}

async function loadOptions() {
  const data = await api('/api/onboarding/options');
  state.options = data.sports;
  renderSports();
}

async function loadSavedInterests() {
  const interests = await api('/api/me/interests');
  state.selectedSports = new Set(interests.sportIds || []);
  state.selectedTeams = new Set(interests.teamIds || []);
  state.selectedPlayers = new Set(interests.playerIds || []);
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
      renderReview('saved-summary');
      showScreen('screen-home');
    } else {
      renderSports();
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
  if (validationError) {
    showMessage(validationError, true);
    return;
  }

  try {
    setBusy(true);
    const path = state.mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const result = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    state.user = result.user;
    setUserPill();
    await loadOptions();
    await loadSavedInterests();

    if (state.selectedSports.size > 0) {
      renderReview('saved-summary');
      showScreen('screen-home');
      showMessage('Welcome back. Your saved preferences are loaded.');
    } else {
      showScreen('screen-sports');
      showMessage(state.mode === 'signup' ? 'Account created. Select your sports.' : 'Welcome back. Continue onboarding.');
    }
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

  if (action === 'show-signup') {
    setAuthMode('signup');
    showScreen('screen-auth');
    return;
  }

  if (action === 'show-login') {
    setAuthMode('login');
    showScreen('screen-auth');
    return;
  }

  if (action === 'go-back') {
    showScreen('screen-welcome');
    return;
  }

  if (action === 'to-favorites') {
    if (state.selectedSports.size === 0) {
      showMessage('Please select at least one sport.', true);
      return;
    }
    renderFavorites();
    showScreen('screen-favorites');
    return;
  }

  if (action === 'back-to-sports') {
    renderSports();
    showScreen('screen-sports');
    return;
  }

  if (action === 'to-review') {
    renderReview('review-content');
    showScreen('screen-review');
    return;
  }

  if (action === 'back-to-favorites') {
    renderFavorites();
    showScreen('screen-favorites');
    return;
  }

  if (action === 'edit-interests') {
    renderSports();
    showScreen('screen-sports');
    return;
  }

  if (action === 'save-interests') {
    if (state.selectedSports.size === 0) {
      showMessage('Please select at least one sport.', true);
      showScreen('screen-sports');
      return;
    }

    try {
      setBusy(true);
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
    } finally {
      setBusy(false);
    }
    return;
  }

  if (action === 'logout') {
    try {
      setBusy(true);
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // Ignore logout errors and reset UI.
    } finally {
      setBusy(false);
    }

    state.user = null;
    state.selectedSports.clear();
    state.selectedTeams.clear();
    state.selectedPlayers.clear();
    state.options = [];
    $('auth-form').reset();
    setUserPill();
    showScreen('screen-welcome');
    showMessage('Logged out.');
  }
});

hydrateUser();
