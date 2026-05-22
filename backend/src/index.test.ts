import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from './index';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function AnthropicMock() {
    return {
      messages: {
        stream: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Once upon' },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' a time.' },
          };
        }),
      },
    };
  }),
}));

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/stories/generate', () => {
  it('streams story chunks for a valid prompt', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A dragon discovers a book' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"chunk":"Once upon"');
    expect(res.text).toContain('[DONE]');
  });

  it('accepts genre and length params', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A wizard casts a spell', genre: 'fantasy', length: 'short' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('[DONE]');
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(app).post('/api/stories/generate').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('prompt is required');
  });

  it('returns 400 when prompt exceeds max length', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2000 characters');
  });

  it('returns 400 for invalid length value', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A tale', length: 'enormous' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('length must be one of');
  });
});
