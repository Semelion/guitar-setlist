// Браузерный слой комнат: публикация и приём RoomState через публичный брокер ntfy.sh.
// Админ: createPublisher (debounce 600 мс). Зритель: createViewer (стартовый poll + SSE,
// при обрыве SSE — статус 'poll' и повторный poll каждые 5 с, пока соединение не восстановится).
import {parseNtfyEvent,parseNtfyPoll,type RoomState} from './room-core';

export const NTFY='https://ntfy.sh';
export const PUBLISH_DEBOUNCE=600;
export const POLL_INTERVAL=5000;
export type PubStatus='idle'|'ok'|'offline';
export type ViewerStatus='connecting'|'live'|'poll'|'offline';

export function createPublisher(topic:string):{publish(rs:RoomState):void;status():PubStatus;close():void}{
 let st:PubStatus='idle',last:RoomState|null=null,timer:ReturnType<typeof setTimeout>|null=null,closed=false;
 const flush=async()=>{
  timer=null;if(closed||!last)return;
  try{const r=await fetch(NTFY+'/'+topic,{method:'POST',body:JSON.stringify(last)});if(!closed)st=r.ok?'ok':'offline';}catch{if(!closed)st='offline';}
 };
 return {
  publish(rs:RoomState){if(closed)return;last=rs;if(timer)clearTimeout(timer);timer=setTimeout(()=>void flush(),PUBLISH_DEBOUNCE);},
  status(){return st;},
  close(){closed=true;if(timer)clearTimeout(timer);timer=null;},
 };
}

export function createViewer(topic:string,onState:(rs:RoomState)=>void,onStatus:(s:ViewerStatus)=>void):{close():void}{
 let es:EventSource|null=null,timer:ReturnType<typeof setInterval>|null=null,closed=false;
 const pollUrl=NTFY+'/'+topic+'/json?poll=1&since=all';
 const drop=()=>{if(timer){clearInterval(timer);timer=null;}};
 const poll=async():Promise<boolean>=>{
  try{
   const r=await fetch(pollUrl);if(!r.ok)throw Error('HTTP '+r.status);
   const rs=parseNtfyPoll(await r.text());
   if(closed)return false;
   if(rs)onState(rs);
   return true;
  }catch{return false;}
 };
 const open=()=>{
  if(closed||es)return;
  es=new EventSource(NTFY+'/'+topic+'/sse');
  es.onmessage=e=>{const rs=parseNtfyEvent(e.data);if(rs&&!closed)onState(rs);};
  es.onopen=()=>{drop();if(!closed)onStatus('live');};
  es.onerror=()=>{
   if(closed)return;
   onStatus('poll');
   if(es&&es.readyState===EventSource.CLOSED){es.close();es=null;}
   if(!timer)timer=setInterval(()=>void tick(),POLL_INTERVAL);
  };
 };
 const tick=async()=>{
  if(closed)return;
  if(!es)open();
  const ok=await poll();
  if(closed)return;
  if(!ok)onStatus('offline');
  else if(!es||es.readyState!==EventSource.OPEN)onStatus('poll');
 };
 onStatus('connecting');
 void (async()=>{await poll();open();})();
 return {close(){closed=true;drop();if(es){es.close();es=null;}}};
}
