import { Router, Request, Response, NextFunction } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

const SYSTEM_PROMPT = `You are a master storyteller with a gift for immersive, vivid narratives.
When given a prompt, craft an engaging story with:
- Compelling characters with distinct voices and motivations
- Vivid sensory details that draw the reader in
- A clear narrative arc with tension and resolution
- Dialogue that feels natural and advances the story
- An appropriate tone that matches the genre

Write directly into the story without preamble or meta-commentary.`;

const LENGTH_TO_TOKENS: Record<string, number> = {
  short: 512,
  medium: 1024,
  long: 2048,
};

const VALID_LENGTHS = new Set(['short', 'medium', 'long']);
const MAX_PROMPT_LENGTH = 2000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 20;
const STORY_SESSION_COOKIE = 'mythos_story_session';
const STORY_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

const storyRateLimitBuckets = new Map<string, RateLimitBucket>();

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authorizationHeader.slice('Bearer '.length);
};

const signSessionValue = (value: string, secret: string): string =>
  createHmac('sha256', secret).update(value).digest('base64url');

const safeEqual = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

const createBrowserSession = (secret: string) => {
  const nonce = randomBytes(32).toString('base64url');
  const issuedAt = String(Date.now());
  const unsignedSession = `${nonce}.${issuedAt}`;
  const signature = signSessionValue(unsignedSession, secret);
  const csrfToken = signSessionValue(`csrf.${unsignedSession}`, secret);

  return {
    cookieValue: `${unsignedSession}.${signature}`,
    csrfToken,
  };
};

const getCookieValue = (req: Request, name: string): string | null => {
  const cookies = req.header('Cookie')?.split(';') ?? [];
  const prefix = `${name}=`;
  const cookie = cookies.map((value) => value.trim()).find((value) => value.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
};

const hasValidBrowserSession = (req: Request, secret: string): boolean => {
  const cookieValue = getCookieValue(req, STORY_SESSION_COOKIE);
  const csrfToken = req.header('X-Story-CSRF');
  if (!cookieValue || !csrfToken) {
    return false;
  }

  const [nonce, issuedAt, signature] = cookieValue.split('.');
  if (!nonce || !issuedAt || !signature) {
    return false;
  }

  const issuedAtMs = Number(issuedAt);
  if (
    !Number.isFinite(issuedAtMs) ||
    Date.now() - issuedAtMs > STORY_SESSION_MAX_AGE_SECONDS * 1000
  ) {
    return false;
  }

  const unsignedSession = `${nonce}.${issuedAt}`;
  const expectedSignature = signSessionValue(unsignedSession, secret);
  const expectedCsrf = signSessionValue(`csrf.${unsignedSession}`, secret);

  return safeEqual(signature, expectedSignature) && safeEqual(csrfToken, expectedCsrf);
};

router.post('/session', (_req: Request, res: Response) => {
  const accessMode = process.env.STORY_API_ACCESS_MODE?.toLowerCase();
  const configuredToken = process.env.STORY_API_TOKEN;

  if (accessMode !== 'token') {
    res.json({ csrfToken: null, accessMode: accessMode ?? 'disabled' });
    return;
  }

  if (!configuredToken) {
    res.status(403).json({
      error: 'story API token mode requires STORY_API_TOKEN to be configured',
    });
    return;
  }

  const session = createBrowserSession(configuredToken);
  res.cookie(STORY_SESSION_COOKIE, session.cookieValue, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: STORY_SESSION_MAX_AGE_SECONDS * 1000,
    path: '/api/stories',
  });
  res.json({ csrfToken: session.csrfToken });
});

const enforceStoryAccess = (req: Request, res: Response, next: NextFunction) => {
  const accessMode = process.env.STORY_API_ACCESS_MODE?.toLowerCase();

  if (accessMode === 'demo') {
    next();
    return;
  }

  if (accessMode === 'token') {
    const configuredToken = process.env.STORY_API_TOKEN;

    if (!configuredToken) {
      res.status(403).json({
        error: 'story API token mode requires STORY_API_TOKEN to be configured',
      });
      return;
    }

    const requestToken = getBearerToken(req.header('Authorization'));
    if (requestToken === configuredToken || hasValidBrowserSession(req, configuredToken)) {
      next();
      return;
    }

    res.status(401).json({
      error: 'authorization bearer token or browser session is required for story generation',
    });
    return;
  }

  res.status(403).json({
    error:
      'story generation is disabled until STORY_API_ACCESS_MODE is set to demo or token',
  });
};

const enforceStoryRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const windowMs = parsePositiveInteger(
    process.env.STORY_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const maxRequests = parsePositiveInteger(
    process.env.STORY_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX,
  );
  const now = Date.now();
  const clientId = req.ip || req.socket.remoteAddress || 'unknown-client';
  const currentBucket = storyRateLimitBuckets.get(clientId);

  if (!currentBucket || now - currentBucket.windowStartedAt >= windowMs) {
    storyRateLimitBuckets.set(clientId, { windowStartedAt: now, count: 1 });
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(maxRequests - 1, 0)));
    next();
    return;
  }

  if (currentBucket.count >= maxRequests) {
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.status(429).json({ error: 'story generation rate limit exceeded' });
    return;
  }

  currentBucket.count += 1;
  res.setHeader('X-RateLimit-Limit', String(maxRequests));
  res.setHeader(
    'X-RateLimit-Remaining',
    String(Math.max(maxRequests - currentBucket.count, 0)),
  );
  next();
};

const resetStoryRateLimits = () => {
  storyRateLimitBuckets.clear();
};

router.post(
  '/generate',
  enforceStoryAccess,
  enforceStoryRateLimit,
  async (req: Request, res: Response) => {
  const { prompt, genre, length = 'medium' } = req.body as {
    prompt?: unknown;
    genre?: unknown;
    length?: unknown;
  };

  if (typeof prompt !== 'string') {
    res.status(400).json({ error: prompt == null ? 'prompt is required' : 'prompt must be a string' });
    return;
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  if (typeof length !== 'string') {
    res.status(400).json({ error: 'length must be one of: short, medium, long' });
    return;
  }

  if (genre != null && typeof genre !== 'string') {
    res.status(400).json({ error: 'genre must be a string' });
    return;
  }

  if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
    res
      .status(400)
      .json({ error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` });
    return;
  }

  if (!VALID_LENGTHS.has(length)) {
    res.status(400).json({ error: 'length must be one of: short, medium, long' });
    return;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) {
    res.status(503).json({
      error: 'ANTHROPIC_API_KEY must be configured before story generation can start',
    });
    return;
  }

  const maxTokens = LENGTH_TO_TOKENS[length] ?? LENGTH_TO_TOKENS.medium;
  const userMessage = genre ? `Genre: ${genre}\n\nPrompt: ${trimmedPrompt}` : trimmedPrompt;

  const client = new Anthropic({ apiKey: anthropicApiKey });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        stream.abort();
      }
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ chunk: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    const error = err as Error & { status?: number };

    if (!res.headersSent) {
      res
        .status(error.status ?? 500)
        .json({ error: error.message ?? 'Story generation failed' });
      return;
    }

    res.write(
      `data: ${JSON.stringify({ error: error.message ?? 'Story generation failed' })}\n\n`,
    );
    res.end();
  }
});

export { router as storyRouter, resetStoryRateLimits };
