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

## Available scripts (run from repo root)

| Script              | What it does                            |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Start backend + frontend in watch mode  |
| `npm run build`     | Type-check and build both packages      |
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

| Variable            | Description                                |
| ------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                     |
| `PORT`              | Backend port (default `3001`)              |

## CI

GitHub Actions runs on every push and pull request to `main`:
1. Install dependencies (`npm ci`)
2. Lint both packages
3. Type-check both packages
4. Test both packages
5. Build both packages
