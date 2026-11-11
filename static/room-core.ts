// Чистая логика комнат для синхронизации через ntfy.sh: состояние эфира,
// топики, генерация/валидация кода комнаты, парсеры ответов брокера.
// Без window/fetch — покрыта тестами tests/room-core.test.mjs.
import type {Session,Song} from '../lib/core.ts';

export type AppState={mode:'select'|'play';session:Session;songs:Song[];ready:boolean};
export type RoomState={
 v:1;room:string;mode:'select'|'play';
 active:{artist:string;title:string;url:string}|null;
 next:{artist:string;title:string;url:string}|null;
 queue:{artist:string;title:string}[];
 played:number;ts:number};

const ROOM_WORDS=['vecher','koster','struny','dvor','lampa','kvartal','pesnya','ogni'];

export function buildRoomState(room:string,s:AppState):RoomState{
 const byId=new Map<string,Song>(s.songs.map(x=>[x.id,x]));
 const track=(id:string)=>{const x=byId.get(id);return x?{artist:x.artist,title:x.title,url:x.url}:null;};
 const activeId=s.mode==='play'&&s.session.active&&byId.has(s.session.active)?s.session.active:null;
 const active=activeId?track(activeId):null;
 let rest=s.session.queue.filter(id=>id!==activeId&&byId.has(id));
 let next=null;
 if(!active&&s.mode==='play'&&rest.length){next=track(rest[0]);if(next)rest=rest.slice(1);}
 return {v:1,room,mode:s.mode,active,next,queue:rest.map(id=>{const x=byId.get(id)!;return{artist:x.artist,title:x.title};}),played:s.session.played.length,ts:Date.now()};
}
export function roomTopic(room:string):string{return 'nstrnh-'+String(room??'').toLowerCase().replace(/[^a-z0-9-]/g,'');}
export function genRoom():string{return ROOM_WORDS[Math.floor(Math.random()*ROOM_WORDS.length)]+'-'+String(Math.floor(Math.random()*1000)).padStart(3,'0');}
export function validRoom(x:string):boolean{return typeof x==='string'&&/^[a-z0-9-]{3,40}$/.test(x);}
export function parseNtfyEvent(data:string):RoomState|null{
 try{const ev=JSON.parse(data) as {message?:string};const st=JSON.parse(ev?.message??'') as RoomState;return st&&st.v===1?st:null;}catch{return null;}
}
export function parseNtfyPoll(text:string):RoomState|null{
 let last:RoomState|null=null;
 for(const line of String(text??'').split('\n')){if(!line.trim())continue;const st=parseNtfyEvent(line);if(st)last=st;}
 return last;
}
