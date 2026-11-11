# SPEC: Мобильная версия (свайпы) + Админ/Зрители

Статус: ТЗ для субагентов A и B. Все пути от `guitar-setlist/`.
НЕ отступать от контрактов. Стиль кода проекта: плотный, без лишних комментариев, как в существующих файлах.

## Общая цель

1. Свайп-жесты на карточке песни в обоих режимах (мобильная версия).
2. Только для статической сборки (GitHub Pages): вход админа по коду-паролю, зрительская страница «сейчас играет» с live-обновлением через ntfy.sh.

---

## ЧАСТЬ A (субагент A): свайпы — общие файлы

### A1. Новый файл `lib/swipe.ts` (чистая логика, без DOM)

```ts
export type SwipeMode = 'select' | 'play';
export type SwipeDir = 'left' | 'right' | null;
export const SWIPE_THRESHOLD = 80;      // мин. горизонтальный путь, px
export const SWIPE_RATIO = 1.4;         // |dx| > |dy| * SWIPE_RATIO
export const SWIPE_MIN_MOVE = 10;       // меньше — это тап, не свайп

// select: right -> 'add', left -> 'skip'
// play:   right -> 'done', left -> 'later'
export function decideSwipe(dx: number, dy: number, mode: SwipeMode): SwipeDir;
export function swipeAction(dir: SwipeDir, mode: SwipeMode): string | null; // 'add'|'skip'|'done'|'later'|null
export function swipeTransform(dx: number): string; // 'translateX(Npx) rotate(Rdeg)', R = clamp(dx/14, -12, 12)
export function swipeHint(dir: SwipeDir, mode: SwipeMode): string;
// select: right 'В плейлист', left 'Пропустить'; play: right 'Сыграли!', left 'В конец очереди'; dir=null -> ''
```

Правило решения: `dir = (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) ? (dx > 0 ? 'right' : 'left') : null`.

### A2. Интеграция в `app/page.tsx`

ВАЖНО: сигнатура компонента уже изменена оркестратором на
`export default function Home({onState}: {onState?: (s: AppState) => void})` — НЕ трогать этот prop и useEffect с onState.

В компонент добавить:
- state: `const [sw, setSw] = useState<{x:number;y:number;drag:boolean}|null>(null)` и refs для стартовой точки (`swipeStart = useRef<{x:number;y:number;t:number}|null>(null)`).
- На `<article className={'song-card '...}>` добавить props:
  - `onTouchStart`: если `e.target.closest('a,button')` — игнорировать (не начинать); иначе запомнить старт.
  - `onTouchMove`: если старт есть — `dx=touch.clientX-start.x, dy=touch.clientY-start.y`; если `Math.abs(dx) > SWIPE_MIN_MOVE && Math.abs(dx) > Math.abs(dy)` → `setSw({x:dx,y:dy,drag:true})`.
  - `onTouchEnd`: если `sw?.drag`: `const dir = decideSwipe(sw.x, sw.y, mode); const a = swipeAction(dir, mode);` при `dir && a && current` → `action(a, mode==='select' ? current.id : undefined)` (для play-действий 'done'/'later' id не нужен). Сбросить `sw=null`, `swipeStart=null`. Если dir=null — просто сброс.
  - `style`: при `sw?.drag` → `{transform: swipeTransform(sw.x), transition:'none'}` + класс `swiping`.
- Внутри article (перед `card-top`) оверлеи подсказок, видны только при drag:
  ```tsx
  {sw?.drag && <div className={'swipe-hint right ' + (sw.x > 40 ? 'show' : '')}>{swipeHint('right', mode)}</div>}
  {sw?.drag && <div className={'swipe-hint left ' + (sw.x < -40 ? 'show' : '')}>{swipeHint('left', mode)}</div>}
  ```
- Рядом с «Разбор открывается в новой вкладке» (stage-foot, режим play) и в select-режиме добавить мобильную подсказку (только CSS-видимую на touch): `<span className="swipe-tip">Свайп: {mode==='select' ? 'вправо — в плейлист, влево — пропустить' : 'вправо — сыграно, влево — в конец'}</span>`.

### A3. Стили — ДОБАВИТЬ В КОНЕЦ `app/globals.css` под маркером `/* ==== swipe ==== */`

```css
/* ==== swipe ==== */
.song-card{touch-action:pan-y}
.song-card.swiping{user-select:none;-webkit-user-select:none}
.swipe-hint{position:absolute;top:18px;z-index:5;padding:9px 15px;border-radius:10px;font-size:12px;font-weight:600;opacity:0;transition:opacity .12s;pointer-events:none}
.swipe-hint.right{right:18px;border:2px solid #9dbb63;color:#c6e08d;transform:rotate(7deg)}
.swipe-hint.left{left:18px;border:2px solid #b4765e;color:#e0a68d;transform:rotate(-7deg)}
.swipe-hint.show{opacity:1}
.swipe-tip{display:none}
@media(hover:none)and(pointer:coarse){.swipe-tip{display:inline;font-size:10px;color:#8b9181}}
```
(Класс `.song-card` уже имеет position:relative и overflow:hidden — оверлеи встанут корректно.)

### A4. Тесты `tests/swipe.test.mjs` (node:test + assert/strict, импорт `../lib/swipe.ts`)

Покрыть: пороги (79px → null, 80px → dir), диагональ (dx=100,dy=90 → null из-за ratio), select right→'add', select left→'skip', play right→'done', play left→'later', dir null→action null, swipeHint все 4 комбинации, swipeTransform содержит 'translateX' и clamp поворота (dx=1000 → rotate ≤ 12deg).

### A5. Запреты для A
- НЕ запускать `npm run build` / `npm run build:static` / dev-серверы (это сделает агент C).
- НЕ трогать: static/**, tests/room-core.test.mjs, .github/**, package.json, vite*.config.ts, tsconfig.json.
- Проверка своего кода: `npx eslint lib/swipe.ts app/page.tsx tests/swipe.test.mjs` и `node --test tests/swipe.test.mjs`.

---

## ЧАСТЬ B (субагент B): админ/зрители — только static/**

Данные синхронизируются через публичный брокер **ntfy.sh** (CORS разрешён, без регистрации):
- публикация: `POST https://ntfy.sh/<topic>` с телом = JSON-строка RoomState;
- чтение истории: `GET https://ntfy.sh/<topic>/json?poll=1&since=all` (построчно JSON-события, поле `message` = наша строка);
- live: `EventSource('https://ntfy.sh/<topic>/sse')`, в `event.data` JSON-событие, поле `message`.
- topic: `'nstrnh-' + room` (комнаты вида `vecher-364`).

### B1. `static/room-core.ts` — ЧИСТАЯ логика (без fetch/window; тестируется в node)

```ts
import type {Session, Song} from '../lib/core.ts';
export type AppState = {mode:'select'|'play'; session:Session; songs:Song[]; ready:boolean};
export type RoomState = {
  v: 1; room: string; mode: 'select'|'play';
  active: {artist:string; title:string; url:string} | null;   // session.active найден в songs
  next:   {artist:string; title:string; url:string} | null;   // active==null && mode=='play' -> queue[0]
  queue:  {artist:string; title:string}[];                    // queue без активного (идут следующими)
  played: number; ts: number;
};
export function buildRoomState(room:string, s:AppState):RoomState; // ts=Date.now()
export function roomTopic(room:string):string;                    // 'nstrnh-'+room, room привести к [a-z0-9-]
export function genRoom():string;   // слово из списка ['vecher','koster','struny','dvor','lampa','kvartal','pesnya','ogni'] + '-' + 3 цифры
export function validRoom(x:string):boolean; // /^[a-z0-9-]{3,40}$/
export function parseNtfyPoll(text:string):RoomState|null; // построчно JSON.parse, брать .message → JSON.parse → последнее с v===1
export function parseNtfyEvent(data:string):RoomState|null; // одно событие SSE
```

### B2. `static/room-client.ts` — браузерный слой

```ts
export const NTFY = 'https://ntfy.sh';
export function createPublisher(topic:string): {publish(rs:RoomState):void; status():'idle'|'ok'|'offline'; close():void};
// debounce 600 мс; POST fetch(NTFY+'/'+topic, {method:'POST', body:JSON.stringify(rs)}); ok→status 'ok', ошибка→'offline'
export function createViewer(topic:string, onState:(rs:RoomState)=>void, onStatus:(s:'connecting'|'live'|'poll'|'offline')=>void): {close():void};
// 1) стартовый poll: fetch(NTFY+'/'+topic+'/json?poll=1&since=all') → parseNtfyPoll → onState
// 2) EventSource(NTFY+'/'+topic+'/sse') → onmessage: parseNtfyEvent → onState; onopen→onStatus('live'); onerror→onStatus('poll') и раз в 5 с повторный poll, пока не восстановится SSE
```

### B3. `static/gate.tsx` — экран входа (React-компонент, TSX)

Полноэкранная карточка в стиле сайта (использовать классы globals.css + свои из viewer.css): логотип «на струнах.», заголовок «Ваш гитарный вечер», две кнопки-ветки:
- «Я зритель» → input кода комнаты (prefill: `?room=` из URL или localStorage `nastrunakh.viewer.room`) → «Смотреть» → перейти на `?room=<code>` (location.replace).
- «Вход для админа» → input пароля → сравнение с `ADMIN_PASS = 'struny'` (регистронезависимо) → при успехе `localStorage['nastrunakh.admin']='1'` → перезагрузка; при ошибке — сообщение «Неверный код».
Props: `{lastRoom:string|null; onAdmin():void}`.

### B4. `static/admin-shell.tsx` — обёртка админа

Рендерит `<Home onState={...}/> ` + плавающую кнопку «Комната» (фикс. правый нижний угол) → панель:
- код комнаты (input, валидация validRoom, сохранение в `nastrunakh.room`; по умолчанию genRoom() при первом входе);
- «Скопировать ссылку зрителя» → `location.origin + location.pathname + '?room=' + room` (navigator.clipboard, fallback prompt);
- индикатор статуса публикации (createPublisher.status(): ok/offline/idle) — точка + текст «Эфир в сети» / «Эфир недоступен»;
- «Выйти из админки» → удалить `nastrunakh.admin`, перезагрузка.
onState: при `s.ready` → `buildRoomState(room, s)` → publisher.publish (debounce внутри publisher). При смене комнаты — новый publisher (закрыть старый), немедленная публикация текущего состояния. Публиковать также сразу при монтировании после первого ready.

### B5. `static/viewer.tsx` — страница зрителя + `static/viewer.css`

Компонент `ViewerApp({room})`: createViewer → состояние RoomState|null + статус.
Вёрстка (свои классы в viewer.css, тёмная «сценическая» тема, использовать CSS-переменные globals.css):
- шапка: «на струнах.» + комната + точка статуса (live/poll/connecting/offline);
- главная карточка: если `active` — лейбл «СЕЙЧАС ИГРАЕМ» (эквалайзер-анимация), если нет active но есть `next` и mode==='play' — «СЛЕДУЮЩАЯ», иначе — «ИДЁТ ОТБОР ПЕСЕН»; artist (мелкий) + title (крупный); кнопка-ссылка «Текст и аккорды ↗» (url) когда есть active/next;
- очередь: нумерованный список queue (title + artist), не более 12, заголовок «Дальше по списку · N»;
- футер: «Сыграно за вечер: played» + «Обновлено HH:MM:SS» (ts);
- пустое состояние (нет RoomState): «Ждём начала вечера… Код комнаты проверен?».
Импорт: `import '../app/globals.css'` НЕ дублировать (его уже импортирует main.tsx), viewer.css импортировать в viewer.tsx.

### B6. `static/main.tsx` — маршрутизация (переписать)

```tsx
import {createRoot} from 'react-dom/client';
import {installLocalApi} from './local-api';
import Home from '../app/page';
import '../app/globals.css';

installLocalApi();
const params = new URLSearchParams(location.search);
const roomParam = (params.get('room') || '').toLowerCase();
const isAdmin = localStorage.getItem('nastrunakh.admin') === '1';
const root = createRoot(document.getElementById('root')!);
if (roomParam && !isAdmin) {
  localStorage.setItem('nastrunakh.viewer.room', roomParam);
  const {ViewerApp} = await import('./viewer');       // динамический импорт ок (top-level await в module)
  root.render(<ViewerApp room={roomParam}/>);
} else if (isAdmin) {
  const {AdminShell} = await import('./admin-shell');
  root.render(<AdminShell/>);
} else {
  const {Gate} = await import('./gate');
  root.render(<Gate lastRoom={localStorage.getItem('nastrunakh.viewer.room')} onAdmin={() => location.reload()}/>);
}
```
(Если top-level await в main нежелателен — обернуть в async IIFE. Home импортируется только внутри AdminShell — убрать статический импорт Home из main.tsx, чтобы бандл зрителя не тащил админский код; AdminShell импортирует Home сам. onState-проп у Home уже есть — контракт: `onState?: (s: AppState) => void`, тип AppState экспортирован из static/room-core.ts; в page.tsx он структурный: {mode,session,songs,ready}.)

### B7. Тесты `tests/room-core.test.mjs` (node:test, импорт `../static/room-core.ts`)

Покрыть: buildRoomState (active из session.active; next=queue[0] при play без active; queue без активного; select → active=null,next=null; played), roomTopic (санитизация 'VecheR 364!' → 'nstrnh-vecher-364' или аналог по правилу [a-z0-9-]), genRoom (формат, уникальность 20 попыток), validRoom, parseNtfyPoll (2 строки, последняя валидная побеждает; мусор игнорируется; v≠1 игнорируется), parseNtfyEvent.

### B8. Запреты для B
- НЕ трогать: app/**, lib/**, tests/swipe.test.mjs, .github/**, package.json, vite*.config.ts, tsconfig.json.
- НЕ запускать полные сборки (агент C). Можно: `npx eslint static/ tests/room-core.test.mjs`, `node --test tests/room-core.test.mjs`.

---

## ЧАСТЬ C (субагент C, после A+B): верификация

1. `npm test` — все тесты (core, static-api, swipe, room-core) зелёные.
2. `npm run build:static` — успех; `npm run build` — успех (vinext не сломан).
3. `npx eslint .  --ignore-pattern dist --ignore-pattern .next --ignore-pattern dist-static` — 0 errors.
4. `npx vite preview --config vite.static.config.ts --port 4174` (фон) → curl `/` 200; curl ассетов 200; в бандле есть 'nstrnh-', 'nastrunakh.admin', 'swipe-hint'.
5. Смоук логики gate в node: имитировать parseNtfyPoll на синтетике (уже в тестах).
6. ОТЧЁТ: таблица команда→PASS/FAIL.

## Контракт, уже внесённый оркестратором в app/page.tsx

```ts
export type AppState = {mode:'select'|'play'; session:Session; songs:Song[]; ready:boolean};
export default function Home({onState}: {onState?: (s: AppState) => void}) { ... }
// + useEffect: useEffect(()=>{onState?.({mode,session,songs,ready});},[mode,session,songs,ready,onState]);
```
