import { Router, Request, Response } from 'express';
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

router.post('/generate', async (req: Request, res: Response) => {
  const { prompt, genre, length = 'medium' } = req.body as {
    prompt?: string;
    genre?: string;
    length?: string;
  };

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    res
      .status(400)
      .json({ error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` });
    return;
  }

  if (!VALID_LENGTHS.has(length)) {
    res.status(400).json({ error: 'length must be one of: short, medium, long' });
    return;
  }

  const maxTokens = LENGTH_TO_TOKENS[length] ?? LENGTH_TO_TOKENS.medium;
  const userMessage = genre ? `Genre: ${genre}\n\nPrompt: ${prompt}` : prompt;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

export { router as storyRouter };
