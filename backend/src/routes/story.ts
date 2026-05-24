import { Router, Request, Response } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 20;

// Exported so tests can override window/max without reimporting.
export function buildStoryRateLimiter(options?: {
  windowMs?: number;
  max?: number;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options?.windowMs ?? RATE_LIMIT_WINDOW_MS,
    max: options?.max ?? RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // req.ip is safe here because trust proxy is configured in createApp().
    // When trust proxy is set, Express resolves req.ip from X-Forwarded-For
    // rather than the raw socket address, giving each real client its own bucket.
    keyGenerator: (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown',
    handler: (_req: Request, res: Response) => {
      // retry-after is set by express-rate-limit before our handler runs (seconds until reset).
      const retryAfter = res.getHeader('retry-after') ?? res.getHeader('Retry-After');
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: retryAfter ? Number(retryAfter) : null,
      });
    },
  });
}

const router = Router();
const storyRateLimiter = buildStoryRateLimiter();

// POST /api/story/generate — AI story generation endpoint.
// Heavy route; rate-limited per resolved client IP.
router.post('/generate', storyRateLimiter, (_req: Request, res: Response) => {
  res.status(200).json({ message: 'ok' });
});

export default router;
