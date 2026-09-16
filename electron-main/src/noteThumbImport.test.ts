import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  importNoteThumbAttachment,
  uniqueAttachmentRelPath,
  THUMB_ATTACHMENTS_DIR,
} from './noteThumbImport.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-thumb-import-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('uniqueAttachmentRelPath', () => {
  it('places the first copy under attachments/', () => {
    expect(uniqueAttachmentRelPath(tmp, 'cover.png')).toBe(`${THUMB_ATTACHMENTS_DIR}/cover.png`);
  });

  it('increments when the slot is taken', () => {
    fs.mkdirSync(path.join(tmp, THUMB_ATTACHMENTS_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmp, THUMB_ATTACHMENTS_DIR, 'cover.png'), Buffer.from('a'));
    expect(uniqueAttachmentRelPath(tmp, 'cover.png')).toBe(`${THUMB_ATTACHMENTS_DIR}/cover-2.png`);
  });
});

describe('importNoteThumbAttachment', () => {
  it('copies an absolute PNG into attachments/ and returns the rel path', () => {
    const src = path.join(tmp, 'picked.png');
    fs.writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const vault = path.join(tmp, 'vault');
    fs.mkdirSync(vault);
    const result = importNoteThumbAttachment(vault, src);
    expect(result).toEqual({ ok: true, relPath: `${THUMB_ATTACHMENTS_DIR}/picked.png` });
    expect(fs.existsSync(path.join(vault, THUMB_ATTACHMENTS_DIR, 'picked.png'))).toBe(true);
  });

  it('rejects a relative source path', () => {
    const result = importNoteThumbAttachment(tmp, 'relative.png');
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported extension', () => {
    const src = path.join(tmp, 'note.md');
    fs.writeFileSync(src, '# hi');
    const result = importNoteThumbAttachment(tmp, src);
    expect(result).toEqual({ ok: false, error: 'unsupported image type' });
  });
});
