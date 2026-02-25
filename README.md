# Sports One - Module 1

Module 1 implementation for your idea:
- Sign up / log in / log out
- Onboarding interests (sports, teams, players)
- Persist interests per user
- Home placeholder screen after setup
- Edit interests flow from Home
- Input validation and loading guards for smoother UX

## Run

Prerequisite: Node.js 18+

```bash
cd /Users/anandpatwa/Documents/sports-one
npm start
```

Open `http://localhost:3000`.

## Quick QA checklist

1. Sign up with invalid email: should show validation error.
2. Sign up with weak password (no number/letter): should fail.
3. Complete onboarding with at least one sport and optional teams/players.
4. Refresh page after completion: should stay logged in and open Home.
5. Click `Edit interests`, change picks, save again, verify updated summary.
6. Log out and log in again: interests should still be saved.

## API (used by the frontend)

- `POST /api/auth/signup`
  - body: `{ "name": "A", "email": "a@x.com", "password": "12345678" }`
- `POST /api/auth/login`
  - body: `{ "email": "a@x.com", "password": "12345678" }`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/onboarding/options`
- `POST /api/onboarding/interests`
  - body: `{ "sportIds": [], "teamIds": [], "playerIds": [] }`
- `GET /api/me/interests`

## Data store

Persistence is file-based for fast MVP delivery:
- `/Users/anandpatwa/Documents/sports-one/data/store.json`

It includes seeded sports/teams/players so onboarding works immediately.
