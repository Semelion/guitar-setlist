import test from 'node:test';
import assert from 'node:assert/strict';
import {
 applyQuizAnswer,
 applyVote,
 buildQuizOptions,
 buildRoomState,
 calcLeaderboard,
 genRoom,
 loadHostState,
 parseNtfyEvent,
 parseNtfyPoll,
 resolveRoundScores,
 roomCmdTopic,
 roomTopic,
 saveHostState,
 validateGuestCommand,
 validRoom,
} from '../static/room-core.ts';

const songs=[
 {id:'s1',artist:'Король и Шут',title:'Кукла колдуна',category:'ru',priority:true,url:'https://x/1',extra_url:'',resource_type:'chords'},
 {id:'s2',artist:'ДДТ',title:'Что такое осень',category:'ru',priority:false,url:'https://x/2',extra_url:'',resource_type:'chords'},
 {id:'s3',artist:'Сплин',title:'Выхода нет',category:'ru',priority:false,url:'https://x/3',extra_url:'',resource_type:'chords'},
 {id:'s4',artist:'Кино',title:'Группа крови',category:'ru',priority:true,url:'https://x/4',extra_url:'',resource_type:'chords'},
];
const app=(mode,session)=>({mode,session,songs,ready:true});
const songsById=new Map(songs.map(s=>[s.id,s]));
const t0=Date.now();

test('buildRoomState: play with active — active from session.active, queue without it',()=>{
 const rs=buildRoomState('vecher-364',app('play',{queue:['s1','s2','s3'],skipped:[],played:['s3','s2'],active:'s1'}));
 assert.equal(rs.v,1);assert.equal(rs.room,'vecher-364');assert.equal(rs.mode,'play');
 assert.deepEqual(rs.active,{artist:'Король и Шут',title:'Кукла колдуна',url:'https://x/1'});
 assert.equal(rs.next,null);
 assert.deepEqual(rs.queue,[{artist:'ДДТ',title:'Что такое осень'},{artist:'Сплин',title:'Выхода нет'}]);
 assert.equal(rs.played,2);
 assert.ok(typeof rs.ts==='number'&&rs.ts>=t0&&rs.ts<=Date.now());
});

test('buildRoomState: play without active — next=queue[0], queue without it',()=>{
 const rs=buildRoomState('r',app('play',{queue:['s2','s3'],skipped:[],played:[],active:null}));
 assert.equal(rs.active,null);
 assert.deepEqual(rs.next,{artist:'ДДТ',title:'Что такое осень',url:'https://x/2'});
 assert.deepEqual(rs.queue,[{artist:'Сплин',title:'Выхода нет'}]);
 assert.equal(rs.played,0);
});

test('buildRoomState: select — active=null, next=null, played=played.length',()=>{
 const rs=buildRoomState('r',app('select',{queue:['s1','s2'],skipped:['s3'],played:['s3','s1','s2'],active:'s1'}));
 assert.equal(rs.mode,'select');assert.equal(rs.active,null);assert.equal(rs.next,null);
 assert.deepEqual(rs.queue,[{artist:'Король и Шут',title:'Кукла колдуна'},{artist:'ДДТ',title:'Что такое осень'}]);
 assert.equal(rs.played,3);
});

test('buildRoomState: Zero-Knowledge — quiz and voting phases redact active, next, queue',()=>{
 const s=app('play',{queue:['s1','s2','s3'],skipped:[],played:[],active:'s1'});
 const rsQuiz=buildRoomState('r',s,{phase:'quiz',round:2});
 assert.equal(rsQuiz.phase,'quiz');
 assert.equal(rsQuiz.active,null);
 assert.equal(rsQuiz.next,null);
 assert.deepEqual(rsQuiz.queue,[]); // Никакой утечки очереди или активной песни!

 const rsVote=buildRoomState('r',s,{phase:'voting',round:2});
 assert.equal(rsVote.phase,'voting');
 assert.equal(rsVote.active,null);
 assert.equal(rsVote.next,null);
 assert.deepEqual(rsVote.queue,[]);
});

test('buildRoomState: ids missing from songs are ignored',()=>{
 const rs=buildRoomState('r',app('play',{queue:['ghost','s2'],skipped:[],played:[],active:'ghost'}));
 assert.equal(rs.active,null);
 assert.deepEqual(rs.next,{artist:'ДДТ',title:'Что такое осень',url:'https://x/2'});
 assert.deepEqual(rs.queue,[]);
});

test('roomTopic & roomCmdTopic: prefix and sanitization',()=>{
 const topic=roomTopic('VecheR 364!');
 assert.equal(topic,'nstrnh-vecher364');
 assert.equal(roomCmdTopic('VecheR 364!'),'nstrnh-vecher364-cmd');
});

test('genRoom: long random collision-resistant code, 20 calls all valid',()=>{
 for(let i=0;i<20;i++){
  const g=genRoom();
  assert.match(g,/^room-[a-f0-9]{32}$/);
  assert.equal(g.split('-')[0],'room');
  assert.equal(validRoom(g),true);
 }
});

test('validRoom: /^[a-z0-9-]{3,50}$/ — valid and invalid samples',()=>{
 assert.equal(validRoom('vecher-364'),true);
 assert.equal(validRoom('abc'),true);
 assert.equal(validRoom('koster-742-m9x1'),true);
 assert.equal(validRoom('ab'),false);
 assert.equal(validRoom('VecheR'),false);
 assert.equal(validRoom('room 1!'),false);
 assert.equal(validRoom('x'.repeat(51)),false);
});

test('buildQuizOptions: requires at least 3 distinct voted songs',()=>{
 const votesSmall=new Map([['s1',3],['s2',1]]);
 const failRes=buildQuizOptions('s1',votesSmall,songsById);
 assert.equal(failRes.ok,false);
 if(!failRes.ok){
  assert.equal(failRes.votedCount,2);
  assert.match(failRes.reason,/минимум 3 разные песни/);
 }

 const votesOk=new Map([['s1',3],['s2',2],['s3',1],['s4',1]]);
 const okRes=buildQuizOptions('s1',votesOk,songsById,()=>0.5);
 assert.equal(okRes.ok,true);
 if(okRes.ok){
  assert.equal(okRes.options.length,3);
  assert.ok(okRes.correctIndex>=0&&okRes.correctIndex<=2);
  const correctOpt=okRes.options[okRes.correctIndex];
  assert.equal(correctOpt.title,'Кукла колдуна');
  assert.equal(new Set(okRes.options.map(o=>o.title)).size,3);
 }
});

test('validateGuestCommand: checks types, integer numbers, and safeUrl',()=>{
 assert.equal(validateGuestCommand(null),null);
 assert.equal(validateGuestCommand({v:1}),null);

 // Invalid URL rejected
 assert.equal(validateGuestCommand({
  v:1,eventId:'e1',participantId:'p1',participantName:'User',
  type:'suggest',custom:{artist:'A',title:'T',url:'javascript:alert(1)'},
 }),null);

 // Non-integer optionIndex or out-of-range rejected
 assert.equal(validateGuestCommand({
  v:1,eventId:'e1',participantId:'p1',participantName:'User',
  type:'quiz_answer',round:1,optionIndex:1.9,
 }),null);
 assert.equal(validateGuestCommand({
  v:1,eventId:'e1',participantId:'p1',participantName:'User',
  type:'quiz_answer',round:1,optionIndex:3,
 }),null);
 assert.equal(validateGuestCommand({
  v:1,eventId:'e1',participantId:'p1',participantName:'User',
  type:'vote',round:-1,songId:'s1',
 }),null);

 // Valid commands
 const vSuggest=validateGuestCommand({
  v:1,eventId:'e1',participantId:'p1',participantName:'User',
  type:'suggest',custom:{artist:'A',title:'T',url:'https://chords.example/song'},
 });
 assert.ok(vSuggest&&vSuggest.type==='suggest');

 const vVote=validateGuestCommand({
  v:1,eventId:'e2',participantId:'p1',participantName:'User',
  type:'vote',round:2,songId:'s2',
 });
 assert.ok(vVote&&vVote.type==='vote'&&vVote.round===2);

 const vAns=validateGuestCommand({
  v:1,eventId:'e3',participantId:'p1',participantName:'User',
  type:'quiz_answer',round:2,optionIndex:1,
 });
 assert.ok(vAns&&vAns.type==='quiz_answer'&&vAns.optionIndex===1);
});

test('pure reducers: applyVote, applyQuizAnswer, resolveRoundScores, calcLeaderboard',()=>{
 // 1. Vote
 const votes0=new Map();
 const voteCmd={v:1,eventId:'e1',participantId:'p1',participantName:'Masha',type:'vote',round:1,songId:'s2',ts:100};
 const r1=applyVote(votes0,voteCmd,1,'voting');
 assert.equal(r1.updated,true);
 assert.equal(r1.votes.get('p1'),'s2');

 const rIgnored=applyVote(r1.votes,voteCmd,2,'voting'); // wrong round
 assert.equal(rIgnored.updated,false);

 // 2. Quiz Answer
 const answers0=new Map();
 const ansCmd1={v:1,eventId:'e2',participantId:'p1',participantName:'Masha',type:'quiz_answer',round:1,optionIndex:0,ts:100};
 const ansCmd2={v:1,eventId:'e3',participantId:'p2',participantName:'Petya',type:'quiz_answer',round:1,optionIndex:1,ts:100};

 const endsAt=Date.now()+20000;
 const a1=applyQuizAnswer(answers0,ansCmd1,1,'quiz',endsAt,Date.now());
 assert.equal(a1.accepted,true);

 // Second answer from p1 is rejected
 const a1Dup=applyQuizAnswer(a1.answers,ansCmd1,1,'quiz',endsAt,Date.now());
 assert.equal(a1Dup.accepted,false);

 const a2=applyQuizAnswer(a1.answers,ansCmd2,1,'quiz',endsAt,Date.now());
 assert.equal(a2.accepted,true);
 assert.equal(a2.answers.size,2);

 // Expired answer is rejected based on receivedAt
 const aExpired=applyQuizAnswer(a2.answers,{...ansCmd1,participantId:'p3'},1,'quiz',endsAt,endsAt+3000);
 assert.equal(aExpired.accepted,false);

 // 3. Resolve scores (correct option is 0)
 const prevScores=new Map([['p1',{name:'Masha',score:2}]]);
 const nextScores=resolveRoundScores(prevScores,a2.answers,0);
 assert.equal(nextScores.get('p1').score,3); // +1 point
 assert.equal(nextScores.get('p1').lastAnswerCorrect,true);
 assert.equal(nextScores.get('p2').score,0); // 0 points for optionIndex 1
 assert.equal(nextScores.get('p2').lastAnswerCorrect,false);

 // Leaderboard ranking
 const lb=calcLeaderboard(nextScores);
 assert.equal(lb[0].name,'Masha');
 assert.equal(lb[0].score,3);
 assert.equal(lb[1].name,'Petya');
 assert.equal(lb[1].score,0);
});

test('host persistence: saveHostState & loadHostState roundtrips state across simulated F5',()=>{
 const mockStorage=new Map();
 const kv={
  getItem:(k)=>mockStorage.get(k)??null,
  setItem:(k,v)=>mockStorage.set(k,v),
 };

 const hostState={
  v:1,
  round:4,
  phase:'revealed',
  scores:[['p1',{name:'Алексей',score:3,lastAnswerCorrect:true}],['p2',{name:'Мария',score:2,lastAnswerCorrect:false}]],
  activeQuiz:null,
  revealedData:{
   round:4,
   correctOptionIndex:1,
   correctSong:{artist:'Кино',title:'Группа крови',url:'https://x/4'},
   votingResults:[{songId:'s4',artist:'Кино',title:'Группа крови',votes:5}],
  },
 };

 saveHostState('vecher-777-k1a2',hostState,kv);
 const loaded=loadHostState('vecher-777-k1a2',kv);
 assert.deepEqual(loaded,hostState);
 assert.equal(loadHostState('unknown-room',kv),null);
});

const rs=(room,v=1)=>({v,room,mode:'play',phase:'idle',round:0,active:null,next:null,queue:[],played:0,ts:1,leaderboard:[]});
const ev=o=>JSON.stringify({id:'m1',time:1700000000,event:'message',topic:'nstrnh-x',message:JSON.stringify(o)});

test('parseNtfyPoll: last valid v===1 wins; garbage and v!==1 ignored; empty -> null',()=>{
 const text=['not json at all',ev(rs('first')),'{"broken',ev({v:2,room:'second'}),ev(rs('third'))].join('\n');
 const got=parseNtfyPoll(text);
 assert.ok(got);assert.equal(got.v,1);assert.equal(got.room,'third');
 assert.equal(parseNtfyPoll(ev(rs('only'))).room,'only');
 assert.equal(parseNtfyPoll('garbage\n{"broken\n\n'),null);
 assert.equal(parseNtfyPoll(ev({v:2,room:'x'})),null);
 assert.equal(parseNtfyPoll(''),null);
});

test('parseNtfyEvent: valid event -> RoomState, garbage -> null',()=>{
 assert.deepEqual(parseNtfyEvent(ev(rs('vecher-364'))),rs('vecher-364'));
 assert.equal(parseNtfyEvent('hello'),null);
 assert.equal(parseNtfyEvent('{}'),null);
 assert.equal(parseNtfyEvent(ev({v:2,room:'x'})),null);
 assert.equal(parseNtfyEvent(JSON.stringify({message:'not json'})),null);
});
