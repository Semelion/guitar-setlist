import {useCallback,useEffect,useRef,useState} from 'react';
import Home from '../app/page';
import {genRoom,roomCmdTopic,roomTopic,validRoom,type AppState,type GuestCommand} from './room-core';
import {createCommandReceiver,createPublisher,type PubStatus} from './room-client';
import {emptyHost,restoreHost,receiveHostCommand,startHostVoting,prepareHost,startHostQuiz,revealHost,hostSnapshot,type HostState,type Suggestion} from './host-state';
import {acceptHostSuggestion,selectHostSong} from './host-library';
import {getStoredChords,saveStoredChords} from '../lib/chords';
import {importChords,isImportableChordUrl} from './chord-import';
import './viewer.css';
const ROOM_KEY='nastrunakh.room';
function initRoom(){
 const code=(new URLSearchParams(location.search).get('room')||localStorage.getItem(ROOM_KEY)||'').trim().toLowerCase();
 if(validRoom(code))return code;
 const fresh=genRoom();localStorage.setItem(ROOM_KEY,fresh);localStorage.setItem('nastrunakh.room_admin.'+fresh,'1');return fresh;
}
function readHost(room:string){try{return restoreHost(JSON.parse(localStorage.getItem('nastrunakh.room_state.'+room)||'null'));}catch{return emptyHost();}}
export function AdminShell(){
 const [room,setRoom]=useState(initRoom);
 // Remount all room-scoped refs and UI together; no old room state can enter a new room.
 return <RoomHost key={room} room={room} changeRoom={setRoom}/>;
}
function RoomHost({room,changeRoom}:{room:string;changeRoom:(room:string)=>void}){
 const [host,setHost]=useState(()=>readHost(room));const hostRef=useRef(host);
 const [panel,setPanel]=useState(false),[draft,setDraft]=useState(room),[err,setErr]=useState(''),[quizErr,setQuizErr]=useState(''),[copied,setCopied]=useState(false),[busy,setBusy]=useState(false);
 const [status,setStatus]=useState<PubStatus>('idle');
 const [chordsOpen,setChordsOpen]=useState(Boolean(host.prepared||host.activeQuiz)),[chordsText,setChordsText]=useState(()=>getStoredChords(host.prepared?.correctSongId||host.activeQuiz?.correctSongId||''));
 const [importing,setImporting]=useState(false),[importErr,setImportErr]=useState(''),[songs,setSongs]=useState<AppState['songs']>([]),[activeId,setActiveId]=useState(host.prepared?.correctSongId||host.activeQuiz?.correctSongId||'');
 const [editorId,setEditorId]=useState(host.prepared?.correctSongId||host.activeQuiz?.correctSongId||'');
 const editorIdRef=useRef(editorId),chordDirty=useRef(false),chordToken=useRef(0);
 const pubRef=useRef<ReturnType<typeof createPublisher>|null>(null),appRef=useRef<AppState|null>(null),opRef=useRef(false),alive=useRef(true);
 const publish=useCallback(()=>{if(appRef.current?.ready)pubRef.current?.publish(hostSnapshot(room,appRef.current,hostRef.current));},[room]);
 const commit=useCallback((next:HostState)=>{
  if(!alive.current||next===hostRef.current)return;
  hostRef.current=next;
  try{localStorage.setItem('nastrunakh.room_state.'+room,JSON.stringify(next));}catch{setErr('Не удалось сохранить состояние комнаты в браузере');}
  setHost(next);publish();
 },[room,publish]);
 const onState=useCallback((s:AppState)=>{appRef.current=s;setSongs(s.songs);setActiveId(s.session.active||'');let next=revealHost(hostRef.current);if(s.ready&&next.phase==='revealed'&&next.revealedData){const song=s.songs.find(x=>x.id===s.session.active);if(!song||song.artist!==next.revealedData.correctSong.artist||song.title!==next.revealedData.correctSong.title)next={...next,phase:'idle',revealedData:null};}if(next!==hostRef.current)commit(next);else publish();},[commit,publish]);
 const receiveRef=useRef<(c:GuestCommand)=>void>(()=>{});
 useEffect(()=>{receiveRef.current=c=>commit(receiveHostCommand(revealHost(hostRef.current),c));},[commit]);
 useEffect(()=>{
  alive.current=true;const pub=createPublisher(roomTopic(room));pubRef.current=pub;
  const receiver=createCommandReceiver(roomCmdTopic(room),c=>receiveRef.current(c));
  // Persist already-resolved restoration before any traffic arrives.
  try{localStorage.setItem('nastrunakh.room_state.'+room,JSON.stringify(hostRef.current));}catch{}
  publish();return()=>{alive.current=false;pub.close();receiver.close();pubRef.current=null;};
 },[room,publish]);
 useEffect(()=>{const q=host.activeQuiz;if(!q)return;const timer=setTimeout(()=>commit(revealHost(hostRef.current)),Math.max(0,q.endsAt-Date.now()));return()=>clearTimeout(timer);},[host.activeQuiz,commit]);
 useEffect(()=>{if(!panel)return;const t=setInterval(()=>setStatus(pubRef.current?.status()??'idle'),1000);return()=>clearInterval(t);},[panel]);
 const run=async(work:()=>Promise<void>)=>{if(opRef.current)return;opRef.current=true;setBusy(true);setQuizErr('');try{await work();}catch(e){if(alive.current)setQuizErr(e instanceof Error?e.message:String(e));}finally{opRef.current=false;if(alive.current)setBusy(false);}};
 const reload=(play=false)=>window.dispatchEvent(new CustomEvent('nastrunakh:reload',{detail:{play}}));
 const startVoting=()=>{const app=appRef.current;if(!app?.ready||opRef.current)return;commit(startHostVoting(hostRef.current,app.songs,app.session.queue));setQuizErr('');};
 const loadChords=useCallback(async(id:string,url?:string)=>{
  if(!id||!isImportableChordUrl(url))return;
  const token=++chordToken.current;setImporting(true);setImportErr('');
  try{const {text}=await importChords(url!);if(!alive.current||token!==chordToken.current||editorIdRef.current!==id||chordDirty.current)return;setChordsText(text);saveStoredChords(id,text);}
  catch(e){if(alive.current&&token===chordToken.current&&editorIdRef.current===id)setImportErr(e instanceof Error?e.message:String(e));}
  finally{if(alive.current&&token===chordToken.current)setImporting(false);}
 },[]);
 const openEditor=(id:string,url?:string)=>{
  editorIdRef.current=id;setEditorId(id);chordDirty.current=false;setImportErr('');
  const stored=id?getStoredChords(id):'';setChordsText(stored);setChordsOpen(true);
  if(id&&!stored.trim())void loadChords(id,url??songs.find(x=>x.id===id)?.url??appRef.current?.songs.find(x=>x.id===id)?.url);
 };
 const prepare=()=>run(async()=>{
  const app=appRef.current;if(!app?.ready)throw Error('Библиотека ещё загружается');
  const result=prepareHost(hostRef.current,app.songs);
  if(result.error)throw Error(result.error);
  const prepared=result.state.prepared;if(!prepared)return;
  commit({...hostRef.current,prepared});
  try{await selectHostSong(fetch,prepared.correctSongId);}catch(e){commit({...hostRef.current,prepared:null});throw e;}
  if(!alive.current)return;
  reload(true);openEditor(prepared.correctSongId,app.songs.find(x=>x.id===prepared.correctSongId)?.url);
 });
 const startPlaying=()=>run(async()=>{
  const s=hostRef.current;if(s.phase!=='voting'||!s.prepared)return;
  saveStoredChords(s.prepared.correctSongId,chordsText);
  await selectHostSong(fetch,s.prepared.correctSongId,true);
  if(!alive.current)return;
  commit(startHostQuiz(hostRef.current));reload(true);
 });
 const normalPlay=()=>run(async()=>{
  const s=hostRef.current;if(s.phase==='quiz')return;
  const app=appRef.current;if(!app?.ready)return;
  const counts=new Map<string,number>();for(const [,id] of s.votes)counts.set(id,(counts.get(id)||0)+1);
  const winner=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||app.session.queue[0];
  if(!winner)throw Error('Добавьте песню в сетлист');
  await selectHostSong(fetch,winner,true);if(!alive.current)return;
  commit({...hostRef.current,phase:'idle',prepared:null,activeQuiz:null,revealedData:null});reload(true);openEditor(winner);
 });
 const accept=(s:Suggestion)=>run(async()=>{await acceptHostSuggestion(fetch,s);if(!alive.current)return;commit({...hostRef.current,suggestions:hostRef.current.suggestions.filter(x=>x.eventId!==s.eventId)});reload();});
 const saveRoom=()=>{const code=draft.trim().toLowerCase();if(!validRoom(code)){setErr('Неверный код комнаты');return;}localStorage.setItem(ROOM_KEY,code);localStorage.setItem('nastrunakh.room_admin.'+code,'1');history.replaceState(null,'','?room='+encodeURIComponent(code));changeRoom(code);};
 const copyLink=async()=>{const link=location.origin+location.pathname+'?room='+encodeURIComponent(room)+'&guest=1';try{await navigator.clipboard.writeText(link);setCopied(true);}catch{window.prompt('Ссылка для гостей:',link);}};
 const q=host.activeQuiz,prepared=host.prepared;
 const editorSong=songs.find(s=>s.id===editorId);
 return <>
  <Home onState={onState} playbackLocked={host.phase==='quiz'||host.phase==='voting'||busy} onPartyPlay={host.phase==='voting'?()=>void prepare():undefined}/>
  <div className="admin-party-bar"><div className="party-bar-actions">
   <button className="button primary party-btn" disabled={busy||host.phase==='quiz'||host.phase==='voting'} onClick={startVoting}>🗳 Открыть голосование</button>
   <button className="button primary party-btn quiz-btn" disabled={busy||host.phase!=='voting'} onClick={()=>void prepare()}>Подготовить песню · Квиз</button>
   <button className="button subtle party-btn" onClick={()=>openEditor(prepared?.correctSongId||q?.correctSongId||activeId||'')}>Аккорды ведущего</button>
   {host.phase==='voting'&&<button className="button secondary party-btn" disabled={busy} onClick={()=>void normalPlay()}>Играть без квиза</button>}
  </div>{host.phase==='quiz'&&<p>Квиз идёт · ответы раскроются через 20 секунд после начала игры.</p>}{quizErr&&<div className="party-error-banner" role="alert">{quizErr}</div>}</div>
  {chordsOpen&&<div className="admin-chords-drawer" role="dialog" aria-label="Аккорды ведущего"><div className="chords-drawer-head"><h3>{editorSong?editorSong.artist+' — '+editorSong.title:'Аккорды ведущего'}</h3><button className="icon-button" onClick={()=>setChordsOpen(false)}>✕</button></div>
   <p className="muted">Текст виден только ведущему. Вставьте и сохраните свои аккорды. Внешние каталоги могут запрещать встраивание.</p>
   <div className="chords-import-row"><button className="button secondary" disabled={importing||!editorId||!isImportableChordUrl(editorSong?.url)} onClick={()=>void loadChords(editorId,editorSong?.url)}>{importing?<><span className="chord-spinner" aria-hidden="true"/>Загрузка…</>:'Загрузить с сайта'}</button>{importing&&<span className="muted">Ищем текст на странице…</span>}</div>
   {importErr&&<p className="chords-import-error" role="alert">{importErr}</p>}
   <textarea className="chords-drawer-textarea" value={chordsText} onChange={e=>{chordDirty.current=true;setChordsText(e.target.value)}} placeholder="Вставьте текст и аккорды для песни…" rows={10}/>
   <div className="chords-drawer-actions"><button className="button primary" disabled={!editorId} onClick={()=>saveStoredChords(editorId,chordsText)}>Сохранить аккорды</button>
    {prepared&&host.phase==='voting'&&<button className="button primary" disabled={busy||importing} onClick={()=>void startPlaying()}>Начать играть · Квиз 20 секунд</button>}
    {editorSong&&<a className="button secondary" href={editorSong.url} target="_blank" rel="noopener noreferrer">Оригинал на сайте ↗</a>}
   </div></div>}
  {host.suggestions.length>0&&<div className="suggestions-badge-panel"><h4>Предложения от гостей ({host.suggestions.length})</h4><div className="suggestions-list">{host.suggestions.map(s=><div key={s.eventId} className="suggestion-item"><div className="suggestion-text"><strong>{s.custom?.title||songs.find(x=>x.id===s.songId)?.title||s.songId}</strong><small>от {s.participantName}</small></div><div className="suggestion-btns"><button className="button primary subtle-sm" disabled={busy} onClick={()=>void accept(s)}>Принять</button><button className="button secondary subtle-sm" disabled={busy} onClick={()=>commit({...hostRef.current,suggestions:hostRef.current.suggestions.filter(x=>x.eventId!==s.eventId)})}>✕</button></div></div>)}</div></div>}
  <button className="room-fab" aria-expanded={panel} onClick={()=>setPanel(x=>!x)}>Комната</button>
  {panel&&<div className="room-panel" role="dialog" aria-label="Управление комнатой"><div className="room-head"><b>Комната эфира: {room}</b><span className={'room-status '+(status==='offline'?'off':'on')}>{status==='offline'?'Нет связи':'Эфир'}</span></div><div className="room-input"><input value={draft} onChange={e=>setDraft(e.target.value)} aria-label="Код комнаты"/><button disabled={busy} onClick={saveRoom}>Сохранить</button></div>{err&&<p className="room-error" role="alert">{err}</p>}<button className="room-copy" onClick={()=>void copyLink()}>{copied?'Ссылка скопирована!':'Скопировать ссылку для гостей'}</button><div className="room-votes-info"><p>Голосов: {host.votes.length} · Раунд {host.round}</p><p>Участников: {host.scores.length}</p></div><button className="room-exit" onClick={()=>{localStorage.removeItem('nastrunakh.room_admin.'+room);location.replace(location.pathname);}}>Выйти из комнаты</button></div>}
 </>;
}
