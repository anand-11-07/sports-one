# Sports One - Module 1

Module 1 implementation for your idea:
- Sign up / log in / log out
- Onboarding interests (sports only)
- Sports catalog with popular-first list and search
- Missing sport request flow
- Persist interests per user
- Home feed screen after setup
- Edit interests flow from Home
- Input validation and loading guards for smoother UX

Module 2 additions:
- Home feed sections for each followed sport
- Infinite scroll loading of sport sections
- Per-sport interest editor for teams, players, and leagues
- Account screen with profile + interest counts

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
3. Complete onboarding with at least one sport.
4. Refresh page after completion: should stay logged in and open Home.
5. Click `Edit interests`, change sports, save again, verify updated summary.
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
 - returns `sportIds`, `teamIds`, `playerIds`, `leagueIds`
- `GET /api/home/feed`
- `GET /api/sports/:sportId/interests-options`
- `POST /api/sports/:sportId/interests`

## Data store

Persistence is file-based for fast MVP delivery:
- `/Users/anandpatwa/Documents/sports-one/data/store.json`

It includes seeded sports/teams/players so onboarding works immediately.
Sport requests are saved under `sportRequests` in the same file.

## Sport request access

1. Direct file access:
- open `/Users/anandpatwa/Documents/sports-one/data/store.json`
- inspect `sportRequests`

2. Admin API:
- `GET /api/admin/sport-requests`
- add header `x-admin-key: sports-one-admin`
- set `ADMIN_KEY` env var in production

## Sustainable Catalog Enrichment

Use admin bulk upsert API to keep teams/players updated over time while onboarding remains sports-only:

- `POST /api/admin/catalog/upsert`
- header: `x-admin-key: sports-one-admin`
- body:
```json
{
  "sportId": "sp_soccer",
  "teams": [{ "name": "Arsenal" }],
  "players": [
    { "name": "Bukayo Saka", "teamName": "Arsenal" }
  ]
}
```
