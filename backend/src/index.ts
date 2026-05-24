import express from 'express';
import storyRouter from './routes/story.js';

export function createApp(options: { trustProxy?: boolean | string | number } = {}) {
  const app = express();

  // Configure proxy trust before any middleware that reads req.ip.
  // Default to "loopback" (safe for local dev); set TRUST_PROXY=1 or a
  // specific subnet in production so X-Forwarded-For is used correctly.
  // Never use `true` (trust all) — it lets any client spoof their IP.
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY ?? 'loopback';
  app.set('trust proxy', trustProxy);

  app.use(express.json());
  app.use('/api/story', storyRouter);

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const app = createApp();
  app.listen(port, () => {
    console.log(`Mythos Writer backend listening on port ${port}`);
  });
}
