# Mythos Writer

AI-powered creative writing and story generation tool — desktop-first, built with React + Node.js.

## Tech Stack

| Layer    | Technology                               |
| -------- | ---------------------------------------- |
| Frontend | React 18, Vite, TypeScript               |
| Backend  | Node.js, Express, TypeScript             |
| AI       | Anthropic Claude API (`@anthropic-ai/sdk`) |
| Tooling  | ESLint, Prettier, Vitest, GitHub Actions |

## Prerequisites

- Node.js 20+
- npm 10+
- An [Anthropic API key](https://console.anthropic.com/)

## Local setup

```bash
# 1. Clone the repo
git clone https://github.com/SkyyPlayz/Mythos-Writer.git
cd Mythos-Writer

# 2. Install all workspace dependencies
npm install

# 3. Configure environment
cp .env.example backend/.env
#    Edit backend/.env and set ANTHROPIC_API_KEY
```

## Running in development

```bash
npm run dev
```

This starts both servers concurrently:
- **Backend** → `http://localhost:3001`
- **Frontend** → `http://localhost:5173` (proxies `/api` to the backend)

## Production-style build and start

```bash
npm run build
STORY_API_ACCESS_MODE=token STORY_API_TOKEN=replace-with-a-secret npm start
```

`npm run build` compiles the backend into `backend/dist` and the frontend into
`frontend/dist`. `npm start` runs the built backend (`node backend/dist/index.js`).
When `frontend/dist/index.html` exists, the backend also serves the built frontend
assets and falls back to the frontend shell for browser routes, while `/api/*` and
`/health` remain handled by Express.

For deployment, set `PORT`, `ANTHROPIC_API_KEY`, `STORY_API_ACCESS_MODE=token`, a
strong `STORY_API_TOKEN`, and a production `STORY_ALLOWED_ORIGINS` value for the
frontend origin before starting the server. Do not commit real secrets.

## Available scripts (run from repo root)

| Script              | What it does                            |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Start backend + frontend in watch mode  |
| `npm run build`     | Type-check and build both packages      |
| `npm start`         | Start the compiled backend and serve built frontend assets |
| `npm run lint`      | ESLint across both packages             |
| `npm run test`      | Vitest across both packages             |
| `npm run typecheck` | `tsc --noEmit` across both packages     |

## Project structure

```
mythos-writer/
├── backend/          # Express + TypeScript API
│   ├── src/
│   │   ├── index.ts          # Server entry point
│   │   └── routes/
│   │       └── story.ts      # /api/story/generate
│   ├── tsconfig.json
│   └── package.json
├── frontend/         # React + Vite + TypeScript UI
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── App.test.tsx
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── .env.example      # Required environment variables
├── .github/
│   └── workflows/
│       └── ci.yml    # GitHub Actions: lint → typecheck → test → build
└── package.json      # Root workspace
```

## Environment variables

Copy `.env.example` to `backend/.env` and fill in:

| Variable                     | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | Your Anthropic API key                                        |
| `PORT`                       | Backend port (default `3001`)                                 |
| `STORY_API_ACCESS_MODE`      | `demo` for local/demo use, or `token` to require bearer auth   |
| `STORY_API_TOKEN`            | Bearer token required when `STORY_API_ACCESS_MODE=token`      |
| `STORY_ALLOWED_ORIGINS`      | Comma-separated CORS allowlist for browser clients            |
| `STORY_RATE_LIMIT_WINDOW_MS` | Story generation rate limit window in milliseconds            |
| `STORY_RATE_LIMIT_MAX`       | Max story generation requests per client per window           |

For production-style deployments, set `STORY_API_ACCESS_MODE=token`, configure a
strong `STORY_API_TOKEN`, and restrict `STORY_ALLOWED_ORIGINS` to the deployed
frontend origin. Local demo installs can keep `STORY_API_ACCESS_MODE=demo` but
are still protected by the configured rate limit/quota.

## CI

GitHub Actions runs on every push to `main` and every pull request:
1. Install dependencies (`npm ci`)
2. Type-check both packages
3. Lint both packages
4. Test both packages
5. Build both packages
6. Start the compiled backend and verify `/health`, `/`, and unknown `/api/*` routing
