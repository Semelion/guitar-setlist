// Встроенное хранилище текста и аккордов для песен.
// Позволяет просматривать и редактировать текст с аккордами внутри сайта,
// сохранять локальные правки в localStorage без выдуманных аккордов.

const CHORD_KEY_PREFIX = 'nastrunakh.chords.';

export function getStoredChords(songId: string, storage?: {getItem(k:string):string|null}): string {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!s) return '';
    return s.getItem(CHORD_KEY_PREFIX + songId) ?? '';
  } catch {
    return '';
  }
}

export function saveStoredChords(songId: string, text: string, storage?: {setItem(k:string,v:string):void}): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!s) return;
    s.setItem(CHORD_KEY_PREFIX + songId, text);
  } catch {}
}
