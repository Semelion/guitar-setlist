import {applyQuizAnswer,buildQuizOptions,buildRoomState,calcLeaderboard,resolveRoundScores,validateGuestCommand,type AppState,type GuestCommand,type QuizOption,type RoomPhase,type RoomState,type VotedSongResult} from './room-core.ts';
import type {Song} from '../lib/core.ts';
export type Suggestion=Extract<GuestCommand,{type:'suggest'}>;
type Prepared={correctSongId:string;correctIndex:number;options:QuizOption[];song:{artist:string;title:string;url:string};votingResults:VotedSongResult[]};
type Quiz=Prepared&{round:number;startedAt:number;durationMs:number;endsAt:number};
export type HostState={v:2;round:number;phase:RoomPhase;votes:[string,string][];answers:[string,{optionIndex:number;participantName:string;receivedAt:number}][];scores:[string,{name:string;score:number;lastAnswerCorrect?:boolean}][];suggestions:Suggestion[];processed:string[];resolved:number[];votingOptions:NonNullable<RoomState['votingOptions']>;prepared:Prepared|null;activeQuiz:Quiz|null;revealedData:RoomState['revealed']|null};
export const emptyHost=():HostState=>({v:2,round:0,phase:'idle',votes:[],answers:[],scores:[],suggestions:[],processed:[],resolved:[],votingOptions:[],prepared:null,activeQuiz:null,revealedData:null});
export function restoreHost(raw:unknown,now=Date.now()):HostState{
 const s=raw as HostState;
 if(!s||s.v!==2||!Number.isInteger(s.round)||!['idle','voting','quiz','revealed'].includes(s.phase)||!['votes','answers','scores','suggestions','processed','resolved','votingOptions'].every(k=>Array.isArray(s[k as keyof HostState])))return emptyHost();
 if(s.phase==='quiz'&&(!s.activeQuiz||!Number.isFinite(s.activeQuiz.endsAt)))return emptyHost();
 return revealHost(s,now);
}
export function startHostVoting(s:HostState,songs:Song[],queue:string[]):HostState{
 if(s.phase==='quiz'||s.phase==='voting')return s;
 const ids=[...new Set([...queue,...songs.map(x=>x.id)])].slice(0,12);
 return {...s,round:s.round+1,phase:'voting',votes:[],answers:[],prepared:null,activeQuiz:null,revealedData:null,votingOptions:ids.flatMap(id=>{const x=songs.find(x=>x.id===id);return x?[{songId:id,artist:x.artist,title:x.title}]:[];})};
}
export function receiveHostCommand(s:HostState,raw:unknown,receivedAt=Date.now()):HostState{
 const cmd=validateGuestCommand(raw);
 if(!cmd||s.processed.includes(cmd.eventId))return s;
 // Keep IDs across F5 and rounds. Old round commands also fail the phase/round guard.
 const next={...s,processed:[...s.processed,cmd.eventId].slice(-20000)};
 if(cmd.type==='suggest')return {...next,suggestions:[...s.suggestions,cmd].slice(-200)};
 if(cmd.type==='vote'){
  if(s.phase!=='voting'||s.prepared||cmd.round!==s.round||!s.votingOptions.some(x=>x.songId===cmd.songId))return next;
  const votes=new Map(s.votes);votes.set(cmd.participantId,cmd.songId);return {...next,votes:[...votes]};
 }
 const q=s.activeQuiz;
 if(!q||receivedAt<q.startedAt)return next;
 const result=applyQuizAnswer(new Map(s.answers),cmd,s.round,s.phase,q.endsAt,receivedAt,0);
 return result.accepted?{...next,answers:[...result.answers]}:next;
}
export function prepareHost(s:HostState,songs:Song[],rng:()=>number=Math.random):{state:HostState;error?:string}{
 if(s.phase!=='voting')return {state:s,error:'Сначала откройте голосование'};
 if(s.prepared)return {state:s};
 const counts=new Map<string,number>();for(const [,id] of s.votes)counts.set(id,(counts.get(id)||0)+1);
 const ordered=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 const winner=ordered[0]?.[0];
 if(!winner)return {state:s,error:'Сначала соберите голоса зрителей'};
 const byId=new Map(songs.map(x=>[x.id,x]));
 const result=buildQuizOptions(winner,counts,byId,rng);
 if(!result.ok)return {state:s,error:result.reason};
 const song=byId.get(winner)!;
 const votingResults=ordered.flatMap(([songId,votes])=>{const x=byId.get(songId);return x?[{songId,artist:x.artist,title:x.title,votes}]:[];});
 return {state:{...s,prepared:{correctSongId:winner,correctIndex:result.correctIndex,options:result.options,song:{artist:song.artist,title:song.title,url:song.url},votingResults}}};
}
export function startHostQuiz(s:HostState,now=Date.now()):HostState{
 if(s.phase!=='voting'||!s.prepared)return s;
 return {...s,phase:'quiz',answers:[],activeQuiz:{...s.prepared,round:s.round,startedAt:now,durationMs:20000,endsAt:now+20000}};
}
export function revealHost(s:HostState,now=Date.now()):HostState{
 const q=s.activeQuiz;
 if(s.phase!=='quiz'||!q||now<q.endsAt||s.resolved.includes(q.round))return s;
 const scores=resolveRoundScores(new Map(s.scores),new Map(s.answers),q.correctIndex);
 return {...s,phase:'revealed',scores:[...scores],activeQuiz:null,prepared:null,resolved:[...s.resolved,q.round],revealedData:{round:q.round,correctOptionIndex:q.correctIndex,correctSong:q.song,votingResults:q.votingResults}};
}
export function hostSnapshot(room:string,app:AppState,s:HostState):RoomState{
 const q=s.activeQuiz;
 return buildRoomState(room,app,{catalog:app.songs.slice(0,2000).map(x=>({songId:x.id,artist:x.artist,title:x.title})),phase:s.phase,round:s.round,leaderboard:calcLeaderboard(new Map(s.scores)).slice(0,100),votingOptions:s.votingOptions,votingClosed:s.phase==='voting'&&Boolean(s.prepared),quiz:q?{round:q.round,startedAt:q.startedAt,durationMs:q.durationMs,endsAt:q.endsAt,options:q.options}:undefined,revealed:s.revealedData??undefined});
}
