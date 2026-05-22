import express, { Express, NextFunction, Request, Response } from 'express';
import cors, { CorsOptions } from 'cors';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { storyRouter, resetStoryRateLimits } from './routes/story';

dotenv.config();

const PORT = process.env.PORT ?? 3001;
const DEFAULT_FRONTEND_DIST_DIR = resolve(__dirname, '../../frontend/dist');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

type CreateAppOptions = {
  staticFrontendDir?: string;
};

const parseAllowedOrigins = () => {
  const configuredOrigins = process.env.STORY_ALLOWED_ORIGINS;

  if (!configuredOrigins) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowedOrigins = parseAllowedOrigins();
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('origin is not allowed by STORY_ALLOWED_ORIGINS'));
  },
};

const createApp = (options: CreateAppOptions = {}): Express => {
  const app = express();
  const staticFrontendDir = options.staticFrontendDir ?? DEFAULT_FRONTEND_DIST_DIR;
  const staticFrontendIndex = join(staticFrontendDir, 'index.html');

  app.use(cors(corsOptions));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mythos-writer-backend' });
  });

  app.use('/api/stories', storyRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  if (existsSync(staticFrontendIndex)) {
    app.use(express.static(staticFrontendDir));
    app.get('*', (_req, res) => {
      res.sendFile(staticFrontendIndex);
    });
  }

  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err.message.includes('STORY_ALLOWED_ORIGINS')) {
      res.status(403).json({ error: 'request origin is not allowed' });
      return;
    }

    next(err);
  });

  return app;
};

const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}

export { app, createApp, resetStoryRateLimits };
