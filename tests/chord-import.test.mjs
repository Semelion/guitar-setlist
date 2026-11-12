import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ChordImportError,
  DEFAULT_CORS_PROXIES,
  fetchChords,
  importChords,
  parseChords,
} from '../static/chord-import.ts';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const CASES = [
  {
    name: 'akkords.pro',
    file: 'akkords2.html',
    url: 'https://akkords.pro/songs/brainstorm/veter-2/',
    firstLine: 'A             Bm7',
    lyric: 'Ветер — как ветер,',
    adjacent: true,
  },
  {
    name: 'mychords.net',
    file: 'mychords2.html',
    url: 'https://mychords.net/a-ha/123-take-on-me.html',
    firstLine: '[Verse 1]',
    lyric: 'Talking away',
    chordsLine: 'Bm       F/Gm',
  },
  {
    name: 'amdm.one',
    file: 'amdm1.html',
    url: 'https://amdm.one/grazhdanskaya-oborona/moya-oborona/',
    firstLine: 'Вступление: Если аккордами: Am F ×4',
    lyric: 'Пластмассовый мир победил.',
    chordsLine: '         Am                F',
  },
  {
    name: 'nagitaru.ru',
    file: 'nagitaru1.html',
    url: 'https://nagitaru.ru/bi-2-kompromiss-akkordy/',
    firstLine: 'Вступление:',
    lyric: 'Друг дорогой, что  ты',
  },
  {
    name: 'gitarizm.ru',
    file: 'gitarizm1.html',
    url: 'https://gitarizm.ru/akkords/leningrad-www',
    firstLine: '\t\t   Hm               Em',
    lyric: '(1)\t\tКогда переехал - не помню,',
    chordsLine: '\t\t   Hm               Em',
  },
  {
    name: 'chordhub.ru',
    file: 'chordhub1.html',
    url: 'https://chordhub.ru/basta/na-zare/',
    firstLine: 'Каподастр: 2 лад',
    lyric: 'Ровный бег моей судьбы',
    chordsLine: ' Am F C Em',
  },
  {
    name: 'guitarflow.ru',
    file: 'guitarflow1.html',
    url: 'https://guitarflow.ru/songs/anacondaz/dubak/',
    firstLine: 'Вступление: Em C G D',
    lyric: 'Алое солнце в зените, звенит будильник — respawn.',
  },
];

for (const item of CASES) {
  test(`parseChords: ${item.name}`, () => {
    const text = parseChords(fixture(item.file), item.url);
    const lines = text.split('\n');

    assert.equal(lines[0], item.firstLine);
    assert.ok(text.includes(item.lyric), `нет строки «${item.lyric}»`);
    assert.ok(text.length > 200, 'подозрительно короткий текст');

    if (item.chordsLine) {
      const chordIndex = lines.indexOf(item.chordsLine);
      assert.notEqual(chordIndex, -1, `нет строки аккордов «${item.chordsLine}»`);
      assert.equal(lines[chordIndex + 1], item.lyric);
    }

    // Никакой разметки, скриптов и рекламных блоков в результате.
    assert.ok(!/<[a-z][^>]*>/i.test(text), 'в тексте осталась HTML-разметка');
    assert.ok(!text.includes('function('), 'в текст попал JavaScript');
  });
}

test('parseChords: несколько блоков <pre> — выбирается лист с аккордами', () => {
  const html = `
    <html><body>
      <pre class="song">1|-----------------|
2|-----------------|</pre>
      <pre class="song">      Am          F
Когда переехал - не помню,</pre>
    </body></html>`;
  const text = parseChords(html, 'https://gitarizm.ru/akkords/test');
  assert.equal(text, '      Am          F\nКогда переехал - не помню,');
});

test('parseChords: <pre> как универсальный запасной вариант', () => {
  const html = `<html><body>
    <nav>Меню сайта</nav>
    <article><h1>Песня</h1>
      <pre>Am        F
Я помню чудное мгновенье,
G         C
Передо мной явилась ты.</pre>
    </article>
    <footer>Подвал</footer>
  </body></html>`;
  const text = parseChords(html, 'https://unknown.example/song');
  assert.equal(text, 'Am        F\nЯ помню чудное мгновенье,\nG         C\nПередо мной явилась ты.');
  assert.ok(!text.includes('Меню сайта'));
  assert.ok(!text.includes('Подвал'));
});

test('parseChords: декодирует сущности и убирает скрипты', () => {
  const html = `<div class="chords"><pre>Am&nbsp;&nbsp;F
Ты &laquo;звезда&raquo; &amp; я — нет.
<script>alert('реклама')</script></pre></div>`;
  const text = parseChords(html, 'https://example.com/song');
  assert.equal(text, 'Am  F\nТы «звезда» & я — нет.');
});

test('parseChords: пустая страница и страница без аккордов дают понятную ошибку', () => {
  assert.throws(() => parseChords('', 'https://example.com/'), ChordImportError);
  assert.throws(
    () => parseChords('<html><body><p>Просто текст без аккордов</p></body></html>', 'https://example.com/'),
    (error) => error instanceof ChordImportError && /не найден текст с аккордами/i.test(error.message),
  );
});

const SIMPLE_PAGE = `<html><body><pre>Am   F
Простая песня</pre></body></html>`;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

test('fetchChords: прямая загрузка без прокси', async () => {
  const calls = [];
  const result = await fetchChords('akkords.pro/song/1', {
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse(SIMPLE_PAGE);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://akkords.pro/song/1');
  assert.equal(result.viaProxy, null);
  assert.equal(parseChords(result.html, 'https://akkords.pro/song/1'), 'Am   F\nПростая песня');
});

test('fetchChords: после CORS-ошибки пробует прокси по порядку', async () => {
  const calls = [];
  const result = await fetchChords('https://mychords.net/song/2', {
    proxies: ['https://proxy-one.example/?u=', 'https://proxy-two.example/?u='],
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === 'https://mychords.net/song/2') throw new TypeError('CORS');
      if (url.startsWith('https://proxy-one.')) throw new TypeError('CORS');
      return jsonResponse(SIMPLE_PAGE);
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0], 'https://mychords.net/song/2');
  assert.equal(
    calls[1],
    'https://proxy-one.example/?u=' + encodeURIComponent('https://mychords.net/song/2'),
  );
  assert.equal(
    calls[2],
    'https://proxy-two.example/?u=' + encodeURIComponent('https://mychords.net/song/2'),
  );
  assert.equal(result.viaProxy, 'https://proxy-two.example/?u=');
});

test('fetchChords: если все способы не сработали — одна понятная ошибка', async () => {
  const calls = [];
  await assert.rejects(
    fetchChords('https://e-chords.com/song', {
      fetchImpl: async (url) => {
        calls.push(url);
        throw new TypeError('Failed to fetch');
      },
    }),
    (error) => error instanceof ChordImportError
      && /CORS/.test(error.message)
      && /вставьте текст вручную/.test(error.message),
  );
  assert.equal(calls.length, DEFAULT_CORS_PROXIES.length + 1);
  for (const proxy of DEFAULT_CORS_PROXIES) {
    assert.ok(calls.some((url) => url.startsWith(proxy)));
  }
});

test('fetchChords: Reader-прокси запрашивает полный HTML', async () => {
  const calls = [];
  await assert.rejects(
    fetchChords('https://akkords.pro/song/3', {
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init?.headers });
        throw new TypeError('CORS');
      },
    }),
    ChordImportError,
  );
  const reader = calls.find(({ url }) => url.startsWith('https://r.jina.ai/'));
  assert.ok(reader);
  assert.equal(reader.headers['X-Return-Format'], 'html');
});

test('fetchChords: таймаут не подвешивает импорт', async () => {
  await assert.rejects(
    fetchChords('https://slow.example/song', {
      proxies: [],
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
    }),
    (error) => error instanceof ChordImportError,
  );
});

test('fetchChords: страница-заглушка Cloudflare не считается успехом', async () => {
  await assert.rejects(
    fetchChords('https://e-chords.com/song', {
      proxies: [],
      fetchImpl: async () => jsonResponse('<html><title>Just a moment...</title><body>Checking your browser</body></html>'),
    }),
    ChordImportError,
  );
});

test('fetchChords: отклоняет неверные ссылки', async () => {
  await assert.rejects(fetchChords('', { proxies: [] }), ChordImportError);
  await assert.rejects(fetchChords('ftp://example.com/song', { proxies: [] }), ChordImportError);
});

test('importChords: загрузка и разбор одним вызовом', async () => {
  const result = await importChords('https://example.com/song', {
    proxies: [],
    fetchImpl: async () => jsonResponse(SIMPLE_PAGE),
  });
  assert.equal(result.text, 'Am   F\nПростая песня');
  assert.equal(result.viaProxy, null);
});
