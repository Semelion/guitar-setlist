// Чистая логика состояния комнат:
// - Публичное состояние эфира RoomState (с защитой/редакцией до reveal)
// - Команды гостей GuestCommand (предложения, голоса, ответы на квиз)
// - Чистые редьюсеры: applyVote, applyQuizAnswer, resolveRoundScores, calcLeaderboard
// - Персистентность стейта хоста (localStorage) для устойчивости к перезагрузкам (F5)
// - Валидация (safeUrl, integer checks, limits), дедупликация, генератор квиза
// Без window/fetch — покрыта тестами tests/room-core.test.mjs.
import {safeUrl,type Session,type Song} from '../lib/core.ts';

export type AppState={mode:'select'|'play';session:Session;songs:Song[];ready:boolean};

export type RoomPhase='idle'|'voting'|'quiz'|'revealed';

export type QuizOption={
 index:number;
 artist:string;
 title:string;
};

export type LeaderboardEntry={
 participantId:string;
 name:string;
 score:number;
 lastAnswerCorrect?:boolean;
};

export type VotedSongResult={
 songId:string;
 artist:string;
 title:string;
 votes:number;
};

export type RoomState={
 v:1;
 room:string;
 mode:'select'|'play';
 phase:RoomPhase;
 round:number;
 active:{artist:string;title:string;url:string}|null;
 next:{artist:string;title:string;url:string}|null;
 queue:{artist:string;title:string}[];
 played:number;
 ts:number;
 catalog?:{songId:string;artist:string;title:string}[];
 votingOptions?:{songId:string;artist:string;title:string}[];
 votingTotalVotes?:number;
 votingClosed?:boolean;
 quiz?:{
  round:number;
  startedAt:number;
  durationMs:number;
  endsAt:number;
  options:QuizOption[];
 };
 revealed?:{
  round:number;
  correctOptionIndex:number;
  correctSong:{artist:string;title:string;url:string};
  votingResults:VotedSongResult[];
 };
 leaderboard:LeaderboardEntry[];
};

export type GuestSuggestCommand={
 v:1;
 eventId:string;
 participantId:string;
 participantName:string;
 type:'suggest';
 ts:number;
 songId?:string;
 custom?:{artist:string;title:string;url:string;category?:string};
};

export type GuestVoteCommand={
 v:1;
 eventId:string;
 participantId:string;
 participantName:string;
 type:'vote';
 ts:number;
 round:number;
 songId:string;
};

export type GuestQuizAnswerCommand={
 v:1;
 eventId:string;
 participantId:string;
 participantName:string;
 type:'quiz_answer';
 ts:number;
 round:number;
 optionIndex:number;
};

export type GuestCommand=GuestSuggestCommand|GuestVoteCommand|GuestQuizAnswerCommand;

export type QuizBuildResult=
 |{ok:true;options:QuizOption[];correctIndex:number;songIds:string[]}
 |{ok:false;reason:string;votedCount:number};

export type RoundAnswers=Map<string,{optionIndex:number;participantName:string;receivedAt:number}>;

export type StoredHostState={
 v:1;
 round:number;
 phase:RoomPhase;
 scores:Array<[string,{name:string;score:number;lastAnswerCorrect?:boolean}]>;
 activeQuiz:{
  round:number;
  correctSongId:string;
  correctIndex:number;
  options:QuizOption[];
  startedAt:number;
  durationMs:number;
  endsAt:number;
 }|null;
 revealedData:{
  round:number;
  correctOptionIndex:number;
  correctSong:{artist:string;title:string;url:string};
  votingResults:VotedSongResult[];
 }|null;
};


export function roomTopic(room:string):string{
 return 'nstrnh-'+String(room??'').toLowerCase().replace(/[^a-z0-9-]/g,'');
}

export function roomCmdTopic(room:string):string{
 return roomTopic(room)+'-cmd';
}

export function genRoom():string{
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 return 'room-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

export function validRoom(x:string):boolean{
 return typeof x==='string'&&/^[a-z0-9-]{3,50}$/.test(x);
}

export function genParticipantId():string{
 return 'p-'+Math.random().toString(36).slice(2,10);
}

export function genEventId():string{
 return 'ev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
}

export function buildRoomState(room:string,s:AppState,extra?:Partial<RoomState>):RoomState{
 const byId=new Map<string,Song>(s.songs.map(x=>[x.id,x]));
 const track=(id:string)=>{const x=byId.get(id);return x?{artist:x.artist,title:x.title,url:x.url}:null;};
 const phase:RoomPhase=extra?.phase??'idle';
 const round:number=extra?.round??0;

 let active:{artist:string;title:string;url:string}|null=null;
 let next:{artist:string;title:string;url:string}|null=null;
 let restQueue:{artist:string;title:string}[]=[];

 if(phase==='quiz'||phase==='voting'){
  // Zero-Knowledge: в фазах квиза и голосования скрываем active, next и queue
  active=null;
  next=null;
  restQueue=[];
 }else{
  const activeId=s.mode==='play'&&s.session.active&&byId.has(s.session.active)?s.session.active:null;
  active=activeId?track(activeId):null;
  let remaining=s.session.queue.filter(id=>id!==activeId&&byId.has(id));
  if(!active&&s.mode==='play'&&remaining.length){
   next=track(remaining[0]);
   if(next)remaining=remaining.slice(1);
  }
  restQueue=remaining.slice(0,12).map(id=>{const x=byId.get(id)!;return{artist:x.artist,title:x.title};});
 }

 const res:RoomState={
  v:1,
  room,
  mode:s.mode,
  phase,
  round,
  active,
  next,
  queue:restQueue,
  played:s.session.played.length,
  ts:Date.now(),
  leaderboard:extra?.leaderboard??[],
  catalog:extra?.catalog,
 };

 if(extra?.votingOptions&&phase==='voting')res.votingOptions=extra.votingOptions;
 if(extra?.votingClosed!==undefined&&phase==='voting')res.votingClosed=extra.votingClosed;
 // Vote totals stay private until reveal.
 if(extra?.quiz&&phase==='quiz')res.quiz=extra.quiz;
 if(extra?.revealed&&phase==='revealed')res.revealed=extra.revealed;

 return res;
}

export function buildQuizOptions(
 correctSongId:string,
 votesBySong:Map<string,number>,
 songsById:Map<string,Song>,
 rng:()=>number=Math.random
):QuizBuildResult{
 const correctSong=songsById.get(correctSongId);
 if(!correctSong)return{ok:false,reason:'Выбранная песня не найдена в каталоге',votedCount:0};

 const votedIds=new Set<string>();
 for(const [id,count] of votesBySong.entries()){
  if(count>0&&songsById.has(id))votedIds.add(id);
 }
 votedIds.add(correctSongId);

 const otherVotedIds=Array.from(votedIds).filter(id=>id!==correctSongId);
 if(otherVotedIds.length<2){
  return{
   ok:false,
   reason:`Для квиза нужно минимум 3 разные песни с голосами зрителей (сейчас: ${votedIds.size}). Соберите голоса минимум за 3 разные песни.`,
   votedCount:votedIds.size,
  };
 }

 // Fisher-Yates shuffle для случайного выбора 2 других проголосованных песен
 for(let i=otherVotedIds.length-1;i>0;i--){
  const j=Math.floor(rng()*(i+1));
  const temp=otherVotedIds[i];
  otherVotedIds[i]=otherVotedIds[j];
  otherVotedIds[j]=temp;
 }

 const wrongSongIds=otherVotedIds.slice(0,2);
 const chosenSongs=[
  {id:correctSongId,song:correctSong},
  {id:wrongSongIds[0],song:songsById.get(wrongSongIds[0])!},
  {id:wrongSongIds[1],song:songsById.get(wrongSongIds[1])!},
 ];

 for(let i=chosenSongs.length-1;i>0;i--){
  const j=Math.floor(rng()*(i+1));
  const temp=chosenSongs[i];
  chosenSongs[i]=chosenSongs[j];
  chosenSongs[j]=temp;
 }

 const correctIndex=chosenSongs.findIndex(x=>x.id===correctSongId);
 const options:QuizOption[]=chosenSongs.map((x,idx)=>({
  index:idx,
  artist:x.song.artist,
  title:x.song.title,
 }));

 return{
  ok:true,
  options,
  correctIndex,
  songIds:chosenSongs.map(x=>x.id),
 };
}

export function applyVote(
 currentVotes:Map<string,string>,
 cmd:GuestVoteCommand,
 currentRound:number,
 phase:RoomPhase
):{updated:boolean;votes:Map<string,string>}{
 if(phase!=='voting'||cmd.round!==currentRound){
  return{updated:false,votes:currentVotes};
 }
 const next=new Map(currentVotes);
 next.set(cmd.participantId,cmd.songId);
 return{updated:true,votes:next};
}

export function applyQuizAnswer(
 currentAnswers:RoundAnswers,
 cmd:GuestQuizAnswerCommand,
 currentRound:number,
 phase:RoomPhase,
 quizEndsAt:number,
 receivedAt:number=Date.now(),
 graceMs:number=0
):{accepted:boolean;reason?:string;answers:RoundAnswers}{
 if(phase!=='quiz')return{accepted:false,reason:'Квиз не активен',answers:currentAnswers};
 if(cmd.round!==currentRound)return{accepted:false,reason:'Неверный раунд',answers:currentAnswers};
 if(receivedAt>=quizEndsAt+graceMs)return{accepted:false,reason:'Время вышло',answers:currentAnswers};
 if(currentAnswers.has(cmd.participantId))return{accepted:false,reason:'Ответ уже принят',answers:currentAnswers};

 const next=new Map(currentAnswers);
 next.set(cmd.participantId,{
  optionIndex:cmd.optionIndex,
  participantName:cmd.participantName,
  receivedAt,
 });
 return{accepted:true,answers:next};
}

export function resolveRoundScores(
 prevScores:Map<string,{name:string;score:number;lastAnswerCorrect?:boolean}>,
 roundAnswers:RoundAnswers,
 correctOptionIndex:number
):Map<string,{name:string;score:number;lastAnswerCorrect?:boolean}>{
 const next=new Map(prevScores);
 for(const [pId,ans] of roundAnswers.entries()){
  const cur=next.get(pId)||{name:ans.participantName,score:0};
  const isCorrect=ans.optionIndex===correctOptionIndex;
  next.set(pId,{
   name:ans.participantName,
   score:cur.score+(isCorrect?1:0),
   lastAnswerCorrect:isCorrect,
  });
 }
 return next;
}

export function calcLeaderboard(
 scores:Map<string,{name:string;score:number;lastAnswerCorrect?:boolean}>
):LeaderboardEntry[]{
 return Array.from(scores.entries())
  .map(([participantId,data])=>({
   participantId,
   name:data.name,
   score:data.score,
   lastAnswerCorrect:data.lastAnswerCorrect,
  }))
  .sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
}

export function saveHostState(
 room:string,
 state:StoredHostState,
 storage?:{setItem(k:string,v:string):void}
):void{
 try{
  const s=storage??(typeof window!=='undefined'?window.localStorage:null);
  if(!s)return;
  s.setItem('nastrunakh.room_state.'+room,JSON.stringify(state));
 }catch{}
}

export function loadHostState(
 room:string,
 storage?:{getItem(k:string):string|null}
):StoredHostState|null{
 try{
  const s=storage??(typeof window!=='undefined'?window.localStorage:null);
  if(!s)return null;
  const raw=s.getItem('nastrunakh.room_state.'+room);
  if(!raw)return null;
  const parsed=JSON.parse(raw) as StoredHostState;
  if(parsed&&parsed.v===1&&typeof parsed.round==='number'&&typeof parsed.phase==='string')return parsed;
  return null;
 }catch{return null;}
}

export function validateGuestCommand(raw:unknown):GuestCommand|null{
 if(!raw||typeof raw!=='object')return null;
 const c=raw as Record<string,unknown>;
 if(
  c.v!==1||
  typeof c.eventId!=='string'||!c.eventId.trim()||c.eventId.length>100||
  typeof c.participantId!=='string'||!c.participantId.trim()||c.participantId.length>100||
  typeof c.participantName!=='string'||!c.participantName.trim()||c.participantName.length>60
 )return null;

 const participantName=c.participantName.trim().slice(0,60);
 const ts=typeof c.ts==='number'&&Number.isFinite(c.ts)?c.ts:Date.now();

 if(c.type==='suggest'){
  if(typeof c.songId==='string'&&c.songId.trim()&&c.songId.length<=100){
   return {
    v:1,
    eventId:c.eventId.trim().slice(0,100),
    participantId:c.participantId.trim().slice(0,100),
    participantName,
    type:'suggest',
    ts,
    songId:c.songId.trim().slice(0,100),
   };
  }
  if(c.custom&&typeof c.custom==='object'){
   const cust=c.custom as Record<string,unknown>;
   if(
    typeof cust.artist==='string'&&cust.artist.trim()&&cust.artist.length<=300&&
    typeof cust.title==='string'&&cust.title.trim()&&cust.title.length<=300&&
    typeof cust.url==='string'&&cust.url.trim()&&cust.url.length<=2000&&
    safeUrl(cust.url.trim())
   ){
    return {
     v:1,
     eventId:c.eventId.trim().slice(0,100),
     participantId:c.participantId.trim().slice(0,100),
     participantName,
     type:'suggest',
     ts,
     custom:{
      artist:cust.artist.trim().slice(0,300),
      title:cust.title.trim().slice(0,300),
      url:cust.url.trim().slice(0,2000),
      category:typeof cust.category==='string'&&['ru','acoustic','electric','remix'].includes(cust.category)?cust.category:'ru',
     },
    };
   }
  }
  return null;
 }

 if(c.type==='vote'){
  if(
   typeof c.round==='number'&&Number.isInteger(c.round)&&c.round>=0&&
   typeof c.songId==='string'&&c.songId.trim()&&c.songId.length<=100
  ){
   return {
    v:1,
    eventId:c.eventId.trim().slice(0,100),
    participantId:c.participantId.trim().slice(0,100),
    participantName,
    type:'vote',
    ts,
    round:c.round,
    songId:c.songId.trim().slice(0,100),
   };
  }
  return null;
 }

 if(c.type==='quiz_answer'){
  if(
   typeof c.round==='number'&&Number.isInteger(c.round)&&c.round>=0&&
   typeof c.optionIndex==='number'&&Number.isInteger(c.optionIndex)&&c.optionIndex>=0&&c.optionIndex<=2
  ){
   return {
    v:1,
    eventId:c.eventId.trim().slice(0,100),
    participantId:c.participantId.trim().slice(0,100),
    participantName,
    type:'quiz_answer',
    ts,
    round:c.round,
    optionIndex:c.optionIndex,
   };
  }
  return null;
 }

 return null;
}

export function parseNtfyEvent<T=RoomState>(data:string):T|null{
 try{
  const ev=JSON.parse(data) as {message?:string};
  const st=JSON.parse(ev?.message??'') as T;
  return st&&(st as unknown as {v:number}).v===1?st:null;
 }catch{return null;}
}

export function parseNtfyPoll<T=RoomState>(text:string):T|null{
 let last:T|null=null;
 for(const line of String(text??'').split('\n')){
  if(!line.trim())continue;
  const st=parseNtfyEvent<T>(line);
  if(st)last=st;
 }
 return last;
}

export function parseNtfyPollAll<T=GuestCommand>(text:string):T[]{
 const res:T[]=[];
 for(const line of String(text??'').split('\n')){
  if(!line.trim())continue;
  const st=parseNtfyEvent<T>(line);
  if(st)res.push(st);
 }
 return res;
}
