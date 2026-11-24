import { describe, expect, it } from 'vitest';
import {
  averageOf,
  computeFinalRating,
  computeSeasonScore,
  computeSeriesScore,
  CRITERIA,
  CRITERIA_KEYS,
  hasAnyRating,
  normalizeCriteria,
  roundRating,
  snapRating,
  toPersianDigits,
  fromPersianDigits,
  formatRating,
} from '../../src/shared/ratings';

describe('snapRating / roundRating', () => {
  it('snaps to the 0.5 grid', () => {
    expect(snapRating(7.3)).toBe(7.5);
    expect(snapRating(7.24)).toBe(7);
    expect(snapRating(0.2)).toBe(0);
    expect(snapRating(9.9)).toBe(10);
  });

  it('clamps to 0–10 and rejects non-finite input', () => {
    expect(snapRating(12)).toBe(10);
    expect(snapRating(-3)).toBe(0);
    expect(snapRating(Number.NaN)).toBe(0);
    expect(snapRating(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('rounds to two decimals without float artefacts', () => {
    expect(roundRating(8.299999999)).toBe(8.3);
    expect(roundRating((7.5 + 8 + 9.5) / 3)).toBe(8.33);
  });
});

describe('averageOf — unrated values never count as zero', () => {
  it('ignores null/undefined entries', () => {
    expect(averageOf([8, null, 6, undefined, 10])).toBe(8);
    expect(averageOf([null, undefined])).toBeNull();
    expect(averageOf([])).toBeNull();
  });

  it('does not treat a missing rating as 0', () => {
    expect(averageOf([8, null])).toBe(8);
    expect(averageOf([8, null])).not.toBe(4);
  });
});

describe('computeFinalRating', () => {
  it('uses the direct score in direct mode', () => {
    expect(computeFinalRating('direct', 7.5, { story: 2 })).toBe(7.5);
    expect(computeFinalRating('direct', null, { story: 9 })).toBe(9);
  });

  it('averages only the criteria that were rated', () => {
    expect(computeFinalRating('criteria', null, { story: 8, characters: 6 })).toBe(7);
    expect(computeFinalRating('criteria', null, { story: 8, characters: 7, direction: 9, sound: 5, impact: 6 })).toBe(7);
    expect(computeFinalRating('criteria', null, {})).toBeNull();
  });

  it('keeps a direct score as fallback when criteria mode has no criteria', () => {
    expect(computeFinalRating('criteria', 6.5, {})).toBe(6.5);
  });

  it('returns null when nothing has been rated', () => {
    expect(computeFinalRating('direct', null, {})).toBeNull();
    expect(computeFinalRating(null, null, null)).toBeNull();
    expect(hasAnyRating('direct', null, {})).toBe(false);
    expect(hasAnyRating('criteria', null, { story: 1 })).toBe(true);
  });

  it('matches the five default criteria keys', () => {
    expect(CRITERIA.map((c) => c.key)).toEqual(['story', 'characters', 'direction', 'sound', 'impact']);
    expect(CRITERIA).toHaveLength(5);
    expect(CRITERIA_KEYS).toContain('impact');
  });
});

describe('season and series scores', () => {
  const episodes = [
    { ratingFinal: 8 },
    { ratingFinal: null },
    { ratingFinal: 6 },
    { ratingFinal: 10 },
    { ratingFinal: null },
  ];

  it('season score is the average of rated episodes only', () => {
    expect(computeSeasonScore(episodes)).toBe(8);
    expect(computeSeasonScore([{ ratingFinal: null }])).toBeNull();
  });

  it('series score is the average across all rated episodes and reports coverage', () => {
    const { score, rated } = computeSeriesScore(episodes);
    expect(score).toBe(8);
    expect(rated).toBe(3);
  });

  it('coverage never counts unrated episodes', () => {
    expect(computeSeriesScore([{ ratingFinal: 5 }, { ratingFinal: null }, { ratingFinal: null }]).rated).toBe(1);
  });
});

describe('normalizeCriteria', () => {
  it('drops invalid values and snaps valid ones', () => {
    expect(normalizeCriteria({ story: 7.3, characters: 11, direction: 'x', sound: -1, impact: 4 })).toEqual({
      story: 7.5,
      impact: 4,
    });
  });

  it('returns an empty object for non-objects', () => {
    expect(normalizeCriteria(null)).toEqual({});
    expect(normalizeCriteria([1, 2])).toEqual({});
    expect(normalizeCriteria('story')).toEqual({});
  });
});

describe('Persian digit helpers', () => {
  it('converts both ways', () => {
    expect(toPersianDigits(1405)).toBe('۱۴۰۵');
    expect(toPersianDigits('8.5')).toBe('۸.۵');
    expect(fromPersianDigits('۱۴۰۵/۰۹/۱۳')).toBe('1405/09/13');
  });

  it('formats ratings with a Persian decimal separator', () => {
    expect(formatRating(8.5)).toBe('۸٫۵');
    expect(formatRating(7)).toBe('۷');
    expect(formatRating(null)).toBe('—');
  });
});
