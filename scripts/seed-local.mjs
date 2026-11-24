/**
 * Seeds the LOCAL development database with three manual items so the UI has
 * something to show in screenshots. Local only — never run against production.
 *
 *   npx wrangler dev --port 8787 --local        # terminal 1
 *   node --experimental-strip-types scripts/seed-local.mjs   # terminal 2
 */
import { deriveAuthKey } from '../src/lib/auth.ts';

const BASE = 'http://127.0.0.1:8787';
let cookie = '';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json };
}

const saltRes = await api('GET', '/api/auth/salt?identifier=smoke_owner');
const authKey = await deriveAuthKey('Correct-Horse-9!', saltRes.json.salt);
const login = await api('POST', '/api/auth/login', { identifier: 'smoke_owner', authKey });
console.log('login', login.status);

const items = [
  {
    title: 'بینستار', originalTitle: 'Interstellar', kind: 'movie', releaseYear: 2014,
    overview: 'گروهی از کاوشگران از میان یک کرم چاله می‌گذرند تا خانه‌ای تازه برای بشریت بیابند.',
    genres: ['علمی‌تخیلی', 'ماجراجویی'], runtimeMinutes: 169, status: 'completed',
    rating: { method: 'criteria', criteria: { story: 9, characters: 8.5, direction: 10, sound: 9.5, impact: 9.5 } },
    watchDate: '2026-02-14', director: 'کریستوفر نولان',
  },
  {
    title: 'برکینگ بد', originalTitle: 'Breaking Bad', kind: 'series', releaseYear: 2008,
    overview: 'معلم شیمی به تولید متامفتامین روی می‌آورد و در دنیای جنایت غرق می‌شود.',
    genres: ['جنایی', 'درام'], runtimeMinutes: 47, status: 'watching',
    rating: { method: 'direct', direct: 9.5 }, watchDate: '2026-08-02',
  },
  {
    title: 'حمله به تایتان', originalTitle: 'Attack on Titan', kind: 'series', isAnime: true, releaseYear: 2013,
    overview: 'بشریت پشت دیوارها پنهان شده است تا از تایتان‌ها در امان بماند.',
    genres: ['انیمه', 'اکشن'], runtimeMinutes: 24, status: 'completed',
    rating: { method: 'criteria', criteria: { story: 9.5, characters: 9, direction: 9.5, sound: 8.5, impact: 10 } },
    watchDate: '2026-05-21',
  },
];

for (const it of items) {
  const { rating, watchDate, ...manual } = it;
  const created = await api('POST', '/api/library', { manual, status: manual.status });
  if (created.status !== 201) { console.log('create failed', created.status, created.json); continue; }
  const id = created.json.id;
  if (rating) {
    const r = await api('POST', `/api/library/${id}/rating`, rating.method === 'direct' ? { method: 'direct', direct: rating.direct } : { method: 'criteria', criteria: rating.criteria });
    console.log('rating', r.status, r.json?.rating?.final);
  }
  if (watchDate) {
    const w = await api('POST', `/api/library/${id}/watch`, { watchedAt: watchDate });
    console.log('watch', w.status);
  }
}
console.log('done');
