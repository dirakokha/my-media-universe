import { describe, expect, it } from 'vitest';
import { generateRecoveryKey, isValidRecoveryKeyShape, normalizeRecoveryKey, passwordIssues, PBKDF2_ITERATIONS, KEY_LENGTH_BITS } from '../../src/lib/auth';
import { looksLikeAnime } from '../../src/shared/constants';

describe('client key derivation parameters', () => {
  it('uses the documented PBKDF2 parameters', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000); // OWASP Password Storage Cheat Sheet
    expect(KEY_LENGTH_BITS).toBe(256);
  });
});

describe('recovery keys', () => {
  it('generates a well-formed grouped key with sufficient entropy', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){7}$/);
    expect(key.replace(/-/g, '')).toHaveLength(32); // 160 bits of entropy
    expect(isValidRecoveryKeyShape(key)).toBe(true);
    const alphabet = new Set(key.replace(/-/g, '').split(''));
    expect(alphabet.size).toBeGreaterThan(1);
  });

  it('does not generate ambiguous characters', () => {
    for (let i = 0; i < 20; i += 1) {
      const key = generateRecoveryKey();
      expect(key).not.toMatch(/[IO01]/); // visually ambiguous glyphs are excluded
    }
  });

  it('normalizes Persian digits, lowercase and whitespace', () => {
    expect(normalizeRecoveryKey('abcd 1234 – efgh 5678')).toBe('ABCD-1234-EFGH-5678');
    expect(normalizeRecoveryKey('  a2b3-c4d5  ')).toBe('A2B3-C4D5');
    expect(normalizeRecoveryKey('۱۲۳۴')).toBe('1234');
    expect(normalizeRecoveryKey('ابد')).toBe(''); // non-ASCII letters are dropped, so shape validation rejects it
  });

  it('accepts a pasted key with Persian digits', () => {
    const key = generateRecoveryKey();
    const persian = key.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    expect(normalizeRecoveryKey(persian)).toBe(key);
    expect(isValidRecoveryKeyShape(normalizeRecoveryKey(persian))).toBe(true);
    expect(isValidRecoveryKeyShape('short')).toBe(false);
    expect(isValidRecoveryKeyShape('ABCD-1234-EFGH-5678')).toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a strong passphrase', () => {
    expect(passwordIssues('Correct-Horse-9!')).toEqual([]);
  });

  it('rejects short or letter-only passwords', () => {
    expect(passwordIssues('short1')).not.toHaveLength(0);
    expect(passwordIssues('onlyletters')).not.toHaveLength(0);
    expect(passwordIssues('1234567890123')).not.toHaveLength(0);
  });
});

describe('anime detection heuristic', () => {
  it('requires the Animation genre and an Asian origin', () => {
    expect(looksLikeAnime({ genres: [{ id: 16, name: 'Animation' }], originCountry: ['JP'] })).toBe(true);
    expect(looksLikeAnime({ genres: [{ id: 16, name: 'Animation' }], originCountry: ['US'] })).toBe(false);
    expect(looksLikeAnime({ genres: [{ id: 28, name: 'Action' }], originCountry: ['JP'] })).toBe(false);
    expect(looksLikeAnime({ genres: [{ id: 16, name: 'Animation' }], originalLanguage: 'ja' })).toBe(true);
  });
});
