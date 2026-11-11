import {useCallback,useEffect,useRef,useState} from 'react';
import Home from '../app/page';
import {buildRoomState,genRoom,roomTopic,validRoom,type AppState} from './room-core';
import {createPublisher} from './room-client';
import './viewer.css';

const ROOM_KEY='nastrunakh.room';
type Pub=ReturnType<typeof createPublisher>;
type PubStatus='idle'|'ok'|'offline';
function initRoom(){
 const saved=localStorage.getItem(ROOM_KEY);
 if(saved&&validRoom(saved))return saved;
 const fresh=genRoom();
 localStorage.setItem(ROOM_KEY,fresh);
 return fresh;
}
export function AdminShell(){
 const [room,setRoom]=useState(initRoom);
 const [panel,setPanel]=useState(false);
 const [draft,setDraft]=useState('');
 const [err,setErr]=useState('');
 const [copied,setCopied]=useState(false);
 const [status,setStatus]=useState<PubStatus>('idle');
 const pubRef=useRef<Pub|null>(null);
 const roomRef=useRef(room);
 const lastRef=useRef<AppState|null>(null);
 const onState=useCallback((s:AppState)=>{
  lastRef.current=s;
  if(!s.ready)return;
  pubRef.current?.publish(buildRoomState(roomRef.current,s));
 },[]);
 useEffect(()=>{
  const pub=createPublisher(roomTopic(room));
  pubRef.current=pub;roomRef.current=room;
  const last=lastRef.current;
  if(last&&last.ready)pub.publish(buildRoomState(room,last));
  return()=>{pub.close();if(pubRef.current===pub)pubRef.current=null;};
 },[room]);
 useEffect(()=>{
  if(!panel)return;
  const t=setInterval(()=>setStatus(pubRef.current?.status()??'idle'),1200);
  return()=>clearInterval(t);
 },[panel]);
 const saveRoom=()=>{
  const code=draft.trim().toLowerCase();
  if(!validRoom(code)){setErr('Неверный код комнаты');return;}
  localStorage.setItem(ROOM_KEY,code);
  setErr('');setCopied(false);setRoom(code);
 };
 const copyLink=async()=>{
  const link=location.origin+location.pathname+'?room='+room;
  try{await navigator.clipboard.writeText(link);setCopied(true);setTimeout(()=>setCopied(false),2500);}
  catch{window.prompt('Скопируйте ссылку зрителя:',link);}
 };
 const logout=()=>{localStorage.removeItem('nastrunakh.admin');location.reload();};
 const toggle=()=>{setPanel(p=>!p);setDraft(room);setErr('');setStatus(pubRef.current?.status()??'idle');};
 return <>
  <Home onState={onState}/>
  <button className="room-fab" aria-expanded={panel} onClick={toggle}>Комната</button>
  {panel&&<div className="room-panel" role="dialog" aria-label="Комната эфира">
   <div className="room-head"><b>Комната эфира</b><span className={'room-status '+(status==='offline'?'off':'on')}><i/>{status==='offline'?'Эфир недоступен':'Эфир в сети'}</span></div>
   <div className="room-input">
    <input value={draft} onChange={e=>{setDraft(e.target.value);setErr('');}} onKeyDown={e=>{if(e.key==='Enter')saveRoom();}} placeholder={room} aria-label="Код комнаты" autoComplete="off"/>
    <button onClick={saveRoom}>Сохранить</button>
   </div>
   {err&&<p className="room-error" role="alert">{err}</p>}
   <button className="room-copy" onClick={copyLink}>{copied?'Ссылка скопирована':'Скопировать ссылку зрителя'}</button>
   <button className="room-exit" onClick={logout}>Выйти из админки</button>
  </div>}
 </>;
}
