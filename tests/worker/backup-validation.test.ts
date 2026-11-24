import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../../worker/lib/http';
import {
  backupDocumentSchema,
  validateBackupDocument,
} from '../../worker/services/backup';
import { SCHEMA_VERSION } from '../../src/shared/constants';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'item-1',
  source: 'manual',
  kind: 'movie',
  title: 'نمونه',
  status: 'completed',
  ratingMethod: 'criteria',
  criteria: { story: 8, sound: 6 },
  ratingFinal: 7,
  ...over,
});

const validDocument = () => ({
  schemaVersion: SCHEMA_VERSION,
  app: 'my-media-universe',
  exportedAt: '2026-11-24T10:00:00.000Z',
  user: { username: 'owner' },
  mediaItems: [
    item(),
    item({ id: 'item-2', kind: 'series', isAnime: true, title: 'Anime', ratingFinal: null }),
  ],
  seasons: [{ id: 's1', mediaItemId: 'item-2', seasonNumber: 1, name: 'فصل ۱' }],
  episodes: [
    {
      id: 'e1',
      mediaItemId: 'item-2',
      seasonNumber: 1,
      episodeNumber: 1,
      name: 'قسمت ۱',
      ratingFinal: 8.5,
    },
  ],
  watchEvents: [
    { id: 'w1', mediaItemId: 'item-1', watchedAt: '2026-11-01', rating: 7 },
  ],
  categories: [{ id: 'c1', name: 'مورد علاقه' }],
  categoryItems: [{ categoryId: 'c1', mediaItemId: 'item-1' }],
  lists: [{ id: 'l1', name: 'بعداً', isWatchlist: true }],
  listItems: [{ listId: 'l1', mediaItemId: 'item-1', position: 1 }],
});

describe('validateBackupDocument', () => {
  it('accepts a complete document and summarises it', () => {
    const { document, summary } = validateBackupDocument(validDocument());
    expect(document.mediaItems).toHaveLength(2);
    expect(summary.counts).toEqual({
      mediaItems: 2,
      episodes: 1,
      seasons: 1,
      watchEvents: 1,
      categories: 1,
      lists: 1,
    });
    expect(summary.mediaTypes).toEqual({ movie: 1, series: 0, anime: 1 });
    expect(summary.schemaVersion).toBe(SCHEMA_VERSION);
    expect(summary.exportedAt).toBe('2026-11-24T10:00:00.000Z');
  });

  it('fills in empty collections so a minimal export still validates', () => {
    const { summary } = validateBackupDocument({ schemaVersion: SCHEMA_VERSION });
    expect(summary.counts.mediaItems).toBe(0);
  });

  it('rejects a document from a newer app version', () => {
    expect(() => validateBackupDocument({ ...validDocument(), schemaVersion: SCHEMA_VERSION + 1 })).toThrowError(
      expect.objectContaining({ code: 'backup_too_new' }),
    );
  });

  it('rejects structurally invalid documents', () => {
    const invalid: unknown[] = [
      null,
      'not an object',
      {},
      { schemaVersion: '1' },
      { schemaVersion: 0 },
      { schemaVersion: 1, mediaItems: 'nope' },
      { schemaVersion: 1, mediaItems: [{ id: 'x', kind: 'podcast', title: 't' }] },
      { schemaVersion: 1, mediaItems: [{ id: 'x', kind: 'movie' }] }, // title missing
      { schemaVersion: 1, mediaItems: [{ id: 'x', kind: 'movie', title: 't', status: 'watched' }] },
      { schemaVersion: 1, mediaItems: [{ id: 'x', kind: 'movie', title: 't', ratingFinal: 'high' }] },
      { schemaVersion: 1, watchEvents: [{ id: 'w', mediaItemId: 'i' }] }, // watchedAt missing
    ];
    for (const doc of invalid) {
      expect(() => validateBackupDocument(doc)).toThrowError(ApiError);
    }
  });

  it('keeps unknown fields for forward compatibility (passthrough)', () => {
    const parsed = backupDocumentSchema.safeParse({
      ...validDocument(),
      futureField: { anything: true },
      mediaItems: [{ ...item(), someFutureColumn: 1 }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).futureField).toEqual({ anything: true });
    }
  });

  it('does not let invalid criteria values through', () => {
    const parsed = backupDocumentSchema.safeParse({
      schemaVersion: 1,
      mediaItems: [{ ...item(), criteria: { story: 'nine' } }],
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps the spoiler flag on watch events through a round-trip', () => {
    const { document } = validateBackupDocument({
      schemaVersion: 1,
      mediaItems: [item()],
      watchEvents: [
        {
          id: 'w-1',
          mediaItemId: item().id,
          watchedAt: '2027-03-04',
          notes: 'پایان فیلم حرف ندارد.',
          isSpoiler: true,
        },
      ],
    });
    expect(document.watchEvents[0].isSpoiler).toBe(true);
  });

  it('caps collection sizes to protect the Worker', () => {
    const big = Array.from({ length: 50_001 }, (_, i) => item({ id: `i-${i}` }));
    expect(() => validateBackupDocument({ schemaVersion: 1, mediaItems: big })).toThrowError(ApiError);
  });
});

describe('zod error shaping', () => {
  it('reports the first issue path so API errors are actionable', () => {
    const parsed = backupDocumentSchema.safeParse({ schemaVersion: 1, mediaItems: [{ id: 'x', kind: 'movie' }] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      expect(z.ZodIssueCode).toBeTruthy();
      expect(issue.path).toContain('mediaItems');
    }
  });
});
