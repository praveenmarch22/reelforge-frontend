# ReelForge web app

React + TypeScript + Vite + Tailwind. Runs with no backend: a mock API in the browser (MSW) answers every `/api/v1` request the way [API_DESIGN.md](https://github.com/praveenmarch22/reelforge-backend/blob/main/docs/API_DESIGN.md) describes.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with the mock API |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve the production build |

## Mock mode

- On by default in development. Turn it off with `VITE_USE_MOCKS=false` in `.env.local` once the real backend is running (see `.env.example`).
- Mock data is stored in your browser's localStorage, so it survives reloads. To start again from the seed data, run this in the browser console and reload:

  ```js
  localStorage.removeItem('rf_mock_db_v1')
  ```

- **Demo account** (has 7 Reels in different states, Instagram connected, admin): email `demo@reelforge.test`, password `reelforge-demo`. The login page has a "Fill in the demo login" link. These are fake values defined in `src/mocks/db.ts`.
- **New accounts**: sign up with any email. No email is sent; the "check your inbox" and "forgot password" screens show a link that stands in for the email.
- A Reel in "Generating" moves forward each time the list is polled and becomes "Ready", to show live progress.

## Structure

```
src/
├── api/            client.ts (fetch, errors, session refresh), hooks.ts (TanStack Query), types.ts
├── mocks/          handlers.ts (mock endpoints, labelled A1, B2...), db.ts (seed data), browser.ts
├── components/
│   ├── ui/         Button, Input, Dialog, Notice, Logo, FullPageSpinner
│   ├── layout/     AuthLayout (sign-in screens), AppShell (sidebar, page header, pills)
│   └── reels/      ReelCard, StatusPill, thumbnail gradients
├── features/
│   ├── auth/       Login, Signup, VerifyEmail, ForgotPassword, ResetPassword, route guards
│   ├── dashboard/  DashboardPage (with empty state)
│   ├── projects/   ProjectsPage (search, filters, delete)
│   └── misc/       ComingSoon placeholders, NotFound
├── lib/            env.ts, cn.ts
├── App.tsx         routes
└── main.tsx        startup (starts the mock API, then React)
```

## Conventions

- All server data goes through hooks in `src/api/hooks.ts`; components never call `fetch` directly.
- Types in `src/api/types.ts` mirror the shared objects in the API design. Change both together.
- Theme tokens (colours, fonts, glass surface) live in `tailwind.config.js` and `src/index.css`.
- Screens not built yet route to `ComingSoon` with their milestone number.
