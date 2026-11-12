// Загрузка текста и аккордов со сторонних сайтов.
//
// В браузере прямой fetch к чужому домену почти всегда упирается в CORS,
// поэтому после первой неудачной попытки пробуем настраиваемые CORS-прокси.
// HTML разбирается маленьким встроенным парсером: он не зависит от DOM,
// поэтому те же функции работают в Node без jsdom и в статической сборке.

// Два классических CORS-прокси плюс Reader от Jina AI: он отдаёт полный HTML
// страницы и, в отличие от большинства бесплатных прокси, отвечает с CORS.
export const DEFAULT_CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
  'https://r.jina.ai/',
] as const;
const READER_PROXY = 'https://r.jina.ai/';

export type FetchChordsOptions = {
  /** Список префиксов CORS-прокси. К URL страницы добавляется encodeURIComponent. */
  proxies?: readonly string[];
  /** Таймаут одной попытки, по умолчанию 10 секунд. */
  timeoutMs?: number;
  /** Подмена fetch для тестов. */
  fetchImpl?: typeof fetch;
};

export type ChordFetchResult = {
  html: string;
  /** Префикс прокси, через который получена страница, либо null для прямой загрузки. */
  viaProxy: string | null;
};

export class ChordImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChordImportError';
  }
}

type AttrMap = Record<string, string>;

type TextNode = { kind: 'text'; text: string };
type ElementNode = { kind: 'element'; tag: string; attrs: AttrMap; children: HtmlNode[] };
type HtmlNode = TextNode | ElementNode;

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'svg', 'iframe', 'noscript', 'template']);

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const SKIP_TAGS = new Set([
  'script', 'style', 'svg', 'noscript', 'template', 'iframe', 'object',
  'embed', 'form', 'input', 'select', 'option', 'textarea', 'audio', 'video',
  'canvas', 'footer', 'nav',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©',
  deg: '°', times: '×', middot: '·', bull: '•', prime: '′', Prime: '″',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

function findTagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function parseAttributes(source: string): AttrMap {
  const attrs: AttrMap = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function parseHtml(html: string): ElementNode {
  const root: ElementNode = { kind: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  const appendText = (text: string) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    const last = parent.children[parent.children.length - 1];
    if (last?.kind === 'text') last.text += text;
    else parent.children.push({ kind: 'text', text });
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      appendText(html.slice(i));
      break;
    }
    if (lt > i) appendText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }

    const isClosing = html.startsWith('</', lt);
    const gt = findTagEnd(html, lt + 1);
    if (gt < 0) {
      appendText(html.slice(lt));
      break;
    }
    const raw = html.slice(lt + 1, gt);

    if (isClosing) {
      const name = raw.replace(/^\//, '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tag === name) {
          stack.length = k;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = raw.trimEnd().endsWith('/');
    const body = selfClosing ? raw.trimEnd().slice(0, -1) : raw;
    const nameMatch = /^([a-zA-Z][^\s/>]*)/.exec(body);
    if (!nameMatch) {
      i = gt + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();
    const element: ElementNode = {
      kind: 'element',
      tag,
      attrs: parseAttributes(body.slice(nameMatch[0].length)),
      children: [],
    };

    if (tag === 'p' && stack[stack.length - 1].tag === 'p') stack.pop();
    if (tag === 'li' && stack[stack.length - 1].tag === 'li') stack.pop();

    stack[stack.length - 1].children.push(element);

    if (selfClosing || VOID_TAGS.has(tag)) {
      i = gt + 1;
      continue;
    }

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'ig');
      closeRe.lastIndex = gt + 1;
      const close = closeRe.exec(html);
      const end = close ? close.index : html.length;
      const text = html.slice(gt + 1, end);
      if (text) element.children.push({ kind: 'text', text });
      i = close ? closeRe.lastIndex : html.length;
      continue;
    }

    stack.push(element);
    i = gt + 1;
  }

  return root;
}

type ParsedSelector = {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value?: string }>;
};

function parseSelector(selector: string): ParsedSelector | null {
  const source = selector.trim();
  if (!source) return null;
  const parsed: ParsedSelector = { classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(source))) {
    consumed += match[0].length;
    if (match[1]) {
      if (match[1] !== '*') parsed.tag = match[1].toLowerCase();
    } else if (match[2]) {
      parsed.id = match[2];
    } else if (match[3]) {
      parsed.classes.push(match[3]);
    } else if (match[4]) {
      parsed.attrs.push({
        name: match[4].toLowerCase(),
        value: match[5] ?? match[6] ?? match[7],
      });
    }
  }
  if (!consumed) return null;
  return parsed;
}

function classTokens(element: ElementNode): string[] {
  return (element.attrs.class ?? '').split(/\s+/).filter(Boolean);
}

function matchesSelector(element: ElementNode, selector: ParsedSelector): boolean {
  if (selector.tag && element.tag !== selector.tag) return false;
  if (selector.id && element.attrs.id !== selector.id) return false;
  if (selector.classes.length) {
    const classes = new Set(classTokens(element));
    if (!selector.classes.every((name) => classes.has(name))) return false;
  }
  for (const attr of selector.attrs) {
    if (!(attr.name in element.attrs)) return false;
    if (attr.value !== undefined && element.attrs[attr.name] !== attr.value) return false;
  }
  return true;
}

function querySelectorAll(root: ElementNode, selector: string): ElementNode[] {
  const selectors = selector.split(',').map(parseSelector).filter((s): s is ParsedSelector => Boolean(s));
  if (!selectors.length) return [];
  const found: ElementNode[] = [];
  const visit = (node: ElementNode) => {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (selectors.some((s) => matchesSelector(child, s))) found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

function isHidden(element: ElementNode): boolean {
  if ('hidden' in element.attrs) return true;
  if (element.attrs['aria-hidden'] === 'true') return true;
  const classes = classTokens(element);
  return classes.includes('amdm-hidden') || classes.includes('visually-hidden');
}

type TextOptions = {
  lineBreakClasses?: ReadonlySet<string>;
};

/**
 * Извлекает текст, сохраняя разбиение на строки и пробелы внутри строки.
 * Блочные элементы и заданные классы начинают новую строку, <br> — тоже.
 */
function extractText(node: ElementNode, options: TextOptions = {}): string {
  const lines: string[] = [];
  let current = '';

  const commit = () => {
    lines.push(current.replace(/[ \t]+$/, ''));
    current = '';
  };
  const breakLine = () => {
    if (current.trim()) commit();
  };

  const append = (text: string) => {
    const parts = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) commit();
      current += parts[i];
    }
  };

  const visit = (child: HtmlNode) => {
    if (child.kind === 'text') {
      append(decodeEntities(child.text));
      return;
    }
    if (SKIP_TAGS.has(child.tag) || isHidden(child)) return;

    if (child.tag === 'br') {
      commit();
      return;
    }
    if (child.tag === 'hr') {
      breakLine();
      lines.push('');
      return;
    }

    const classes = classTokens(child);
    const isBlock = BLOCK_TAGS.has(child.tag)
      || Boolean(options.lineBreakClasses && classes.some((name) => options.lineBreakClasses?.has(name)));

    if (isBlock) breakLine();
    for (const grandchild of child.children) visit(grandchild);
    if (isBlock) breakLine();
  };

  for (const child of node.children) visit(child);
  if (current.trim()) commit();

  const cleaned = lines.map((line) => line.replace(/[ \t]+$/, ''));
  while (cleaned.length && !cleaned[0].trim()) cleaned.shift();
  while (cleaned.length && !cleaned[cleaned.length - 1].trim()) cleaned.pop();

  const result: string[] = [];
  for (const line of cleaned) {
    if (!line.trim()) {
      if (result.length && result[result.length - 1] !== '') result.push('');
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

const CHORD_TOKEN = /(?:^|[\s|])((?:[A-H](?:#|b)?)(?:maj|min|dim|aug|sus|add|no|m)?\d*(?:\/[A-H](?:#|b)?)?)(?=$|[\s|])/g;

function chordTokenCount(line: string): number {
  return line.match(CHORD_TOKEN)?.length ?? 0;
}

function chordLineWeight(line: string): number {
  const tokens = chordTokenCount(line);
  if (!tokens) return 0;
  const rest = line
    .replace(CHORD_TOKEN, ' ')
    .replace(/[|/\\\-–—:()x×.,!?«»"'[\]]/g, '')
    .trim();
  const letters = rest.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
  if (!letters.length) return tokens;
  return letters.length <= 12 && tokens >= 2 ? tokens : 0;
}

function looksLikeChordSheet(text: string): boolean {
  const lines = text.split('\n');
  let chordLines = 0;
  let tokens = 0;
  for (const line of lines) {
    const weight = chordLineWeight(line);
    if (weight > 0) {
      chordLines++;
      tokens += weight;
    }
  }
  return chordLines >= 1 && tokens >= 2;
}

function sheetScore(text: string): number {
  const lines = text.split('\n');
  let chordLines = 0;
  let tokens = 0;
  for (const line of lines) {
    const weight = chordLineWeight(line);
    if (weight > 0) {
      chordLines++;
      tokens += weight;
    }
  }
  if (!chordLines) return -1;
  return Math.min(text.length, 6000) + chordLines * 120 + tokens * 20;
}

type DomainRule = {
  hosts: RegExp;
  selectors: string[];
  lineBreakClasses?: string[];
  cleanup?: (text: string) => string;
};

const COMMON_LINE_CLASSES = [
  'single-line', 'pline', 'c-subline', 'subline',
  'st', 'l', 'cs',
  'amdm-part', 'amdm-line', 'amdm-row', 'amdm-words', 'amdm-prog', 'amdm-label',
];

const DOMAIN_RULES: DomainRule[] = [
  {
    hosts: /(^|\.)akkords\.pro$/,
    selectors: ['p.chords', '.entry-content p.chords'],
  },
  {
    hosts: /(^|\.)guitarflow\.ru$/,
    selectors: ['p.chords', '.entry-content p.chords'],
  },
  {
    hosts: /(^|\.)mychords\.net$/,
    selectors: ['.w-words__text', '[itemprop="text"]', '.b-words__text-background'],
    lineBreakClasses: COMMON_LINE_CLASSES,
  },
  {
    hosts: /(^|\.)amdm\.(one|ru)$/,
    selectors: ['.amdm-sheet', '[data-amdm-sheet]'],
    lineBreakClasses: COMMON_LINE_CLASSES,
  },
  {
    hosts: /(^|\.)nagitaru\.ru$/,
    selectors: ['.entry-content pre', 'pre'],
  },
  {
    hosts: /(^|\.)gitarizm\.ru$/,
    selectors: ['pre.song', 'pre'],
    cleanup: (text) => text.split('\n').filter((line) => !/^\s*WWW\s*$/i.test(line)).join('\n'),
  },
  {
    hosts: /(^|\.)chordhub\.ru$/,
    selectors: ['.sheet__body', '.sheet'],
    lineBreakClasses: COMMON_LINE_CLASSES,
  },
  {
    hosts: /(^|\.)e-chords\.com$/,
    selectors: ['#core', 'pre', '.core'],
  },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function bestCandidate(root: ElementNode, selectors: string[], lineBreakClasses?: string[]): string {
  const classes = lineBreakClasses ? new Set(lineBreakClasses) : undefined;
  let best = '';
  let bestScore = -1;
  for (const selector of selectors) {
    for (const element of querySelectorAll(root, selector)) {
      const text = extractText(element, { lineBreakClasses: classes });
      if (!text) continue;
      const score = looksLikeChordSheet(text) ? sheetScore(text) : -1;
      if (score > bestScore || (score < 0 && bestScore < 0 && text.length > best.length)) {
        best = text;
        bestScore = score;
      }
    }
    // Селекторы перечислены от точного к общему: если точный дал результат,
    // более общий уже не нужен.
    if (bestScore >= 0 || best.length >= 40) break;
  }
  return best;
}

function genericCandidates(root: ElementNode): string[] {
  const classes = new Set(COMMON_LINE_CLASSES);
  const seen = new Set<ElementNode>();
  const texts: string[] = [];
  const push = (elements: ElementNode[]) => {
    for (const element of elements) {
      if (seen.has(element)) continue;
      seen.add(element);
      const text = extractText(element, { lineBreakClasses: classes });
      if (text) texts.push(text);
    }
  };

  push(querySelectorAll(root, 'pre, p.chords, div.chords, [class*="chord"], [id*="chord"], [itemprop="text"], .w-words__text, .amdm-sheet, .sheet__body'));
  if (!texts.some(looksLikeChordSheet)) {
    push(querySelectorAll(root, 'article, main, #content, .entry-content, .song-text, .text'));
  }
  return texts;
}

function genericParse(root: ElementNode): string {
  const candidates = genericCandidates(root);
  let best = '';
  let bestScore = -1;
  for (const text of candidates) {
    const score = sheetScore(text);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : '';
}

function finalizeText(text: string, rule?: DomainRule): string {
  let result = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  if (rule?.cleanup) result = rule.cleanup(result);
  const lines = result.split('\n').map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const compact: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (compact.length && compact[compact.length - 1] !== '') compact.push('');
    } else {
      compact.push(line);
    }
  }
  return compact.join('\n');
}

/**
 * Разбирает HTML страницы с аккордами и возвращает текст с сохранёнными
 * переносами строк и позициями аккордов над строками.
 */
export function parseChords(html: string, url: string): string {
  if (!html.trim()) {
    throw new ChordImportError('Страница пустая: сайт не отдал HTML.');
  }

  const root = parseHtml(html);
  const host = hostOf(url);
  const rule = DOMAIN_RULES.find((item) => item.hosts.test(host));

  let text = '';
  if (rule) text = bestCandidate(root, rule.selectors, rule.lineBreakClasses);
  if (!text || !looksLikeChordSheet(text)) {
    const generic = genericParse(root);
    if (generic && (!text || !looksLikeChordSheet(text) || generic.length > text.length)) text = generic;
  }

  text = finalizeText(text, rule);
  if (!text || text.length < 20 || !looksLikeChordSheet(text)) {
    throw new ChordImportError(
      'На странице не найден текст с аккордами. Откройте оригинал и вставьте текст вручную.',
    );
  }
  return text;
}

function looksLikeBlockPage(html: string): boolean {
  const head = html.slice(0, 4000);
  return /just a moment|checking your browser|cf-challenge|captcha|access denied|attention required/i.test(head);
}

function normalizePageUrl(url: string): string {
  const value = url.trim();
  if (!value) throw new ChordImportError('Укажите ссылку на страницу с аккордами.');
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new ChordImportError('Некорректная ссылка на страницу с аккордами.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ChordImportError('Поддерживаются только ссылки http и https.');
  }
  return parsed.toString();
}

async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ChordImportError('Превышено время ожидания загрузки страницы.'));
    }, timeoutMs);
  });

  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml', ...extraHeaders },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (!body || body.length < 50) throw new Error('пустой ответ');
      if (looksLikeBlockPage(body)) throw new Error('сайт требует проверку браузера');
      return body;
    })();
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Загружает HTML страницы: сначала напрямую, затем по очереди через CORS-прокси.
 */
export async function fetchChords(
  url: string,
  options: FetchChordsOptions = {},
): Promise<ChordFetchResult> {
  const pageUrl = normalizePageUrl(url);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const proxies = options.proxies ?? DEFAULT_CORS_PROXIES;

  const attempts: Array<{ target: string; proxy: string | null }> = [
    { target: pageUrl, proxy: null },
    ...proxies.map((proxy) => ({ target: proxy + encodeURIComponent(pageUrl), proxy })),
  ];

  for (const attempt of attempts) {
    try {
      const html = await fetchText(
        fetchImpl,
        attempt.target,
        timeoutMs,
        attempt.proxy === READER_PROXY ? { 'X-Return-Format': 'html' } : undefined,
      );
      return { html, viaProxy: attempt.proxy };
    } catch {
      // Пробуем следующий способ: прямой запрос мог быть заблокирован CORS.
    }
  }

  throw new ChordImportError(
    'Не удалось загрузить страницу с аккордами. Сайт может блокировать загрузку (CORS) — откройте оригинал и вставьте текст вручную.',
  );
}

/** Загружает страницу и сразу разбирает её в текст с аккордами. */
export async function importChords(
  url: string,
  options: FetchChordsOptions = {},
): Promise<{ text: string; viaProxy: string | null }> {
  const { html, viaProxy } = await fetchChords(url, options);
  return { text: parseChords(html, url), viaProxy };
}

/** Можно ли пробовать загрузить аккорды по этой ссылке (YouTube и не-http не подходят). */
export function isImportableChordUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const pageUrl = new URL(normalizePageUrl(url));
    if (!/^https?:$/.test(pageUrl.protocol)) return false;
    return !/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(pageUrl.hostname);
  } catch {
    return false;
  }
}
