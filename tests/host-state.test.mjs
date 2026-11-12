import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyHost,startHostVoting,receiveHostCommand,prepareHost,startHostQuiz,restoreHost,revealHost,hostSnapshot} from '../static/host-state.ts';
import {acceptHostSuggestion,selectHostSong} from '../static/host-library.ts';
const songs=['a','b','c','d'].map(id=>({id,artist:'Artist '+id,title:'Title '+id,url:'https://example.com/'+id,category:'ru',priority:false,resource_type:'chords',extra_url:''}));
const session={queue:['d'],active:null,played:[],skipped:[]};
const cmd=(type,id,extra={})=>({v:1,type,eventId:type+'-'+id,participantId:id,participantName:'Guest '+id,ts:9999999,...extra});
function prepared(){let s=startHostVoting(emptyHost(),songs,session.queue);for(let i=0;i<3;i++)s=receiveHostCommand(s,cmd('vote','p'+i,{round:s.round,songId:songs[i].id}),10);return prepareHost(s,songs,()=>0.3).state;}
test('complete round: preparation hides winner, explicit start, receipt-time answers, reveal once',()=>{
 let s=prepared();assert.equal(s.phase,'voting');assert.equal(s.activeQuiz,null);assert.equal(s.prepared.options.length,3);assert.equal(new Set(s.prepared.options.map(x=>x.title)).size,3);
 const before=hostSnapshot('room',{mode:'play',songs,session,ready:true},s);assert.equal(before.active,null);assert.equal(before.next,null);assert.equal(before.revealed,undefined);assert.equal(before.votingTotalVotes,undefined);assert.equal(before.votingOptions.length,4);assert.equal(before.votingClosed,true);
 s=startHostQuiz(s,1000);assert.equal(s.activeQuiz.endsAt,21000);assert.equal(startHostQuiz(s,2000),s);assert.equal(startHostVoting(s,songs,[]),s);
 const correct=s.activeQuiz.correctIndex;
 s=receiveHostCommand(s,cmd('quiz_answer','p0',{round:1,optionIndex:correct}),1001);
 s=receiveHostCommand(s,cmd('quiz_answer','p0',{eventId:'second',round:1,optionIndex:(correct+1)%3}),1002);assert.equal(s.answers.length,1);
 s=receiveHostCommand(s,cmd('quiz_answer','late',{round:1,optionIndex:correct,ts:1001}),21000);assert.equal(s.answers.length,1);
 assert.equal(revealHost(s,20999),s);s=revealHost(s,21000);assert.equal(s.phase,'revealed');assert.equal(s.scores[0][1].score,1);assert.equal(s.revealedData.votingResults.length,3);assert.equal(revealHost(s,22000),s);
});
test('reload in quiz preserves answers/votes/dedup/options/deadline and rearms remaining interval',()=>{
 let s=startHostQuiz(prepared(),1000);s=receiveHostCommand(s,cmd('quiz_answer','p0',{round:1,optionIndex:s.activeQuiz.correctIndex}),5000);
 const restored=restoreHost(JSON.parse(JSON.stringify(s)),10000);assert.deepEqual(restored,s);assert.equal(restored.activeQuiz.endsAt-10000,11000);
 const replay=receiveHostCommand(restored,cmd('quiz_answer','p0',{round:1,optionIndex:1}),11000);assert.equal(replay,restored);
 const ended=revealHost(restored,21000);assert.equal(ended.scores[0][1].score,1);
});
test('reload after deadline awards once; subsequent reload and stale commands cannot score again',()=>{
 let s=startHostQuiz(prepared(),1000);s=receiveHostCommand(s,cmd('quiz_answer','p0',{round:1,optionIndex:s.activeQuiz.correctIndex}),5000);
 let restored=restoreHost(JSON.parse(JSON.stringify(s)),50000);assert.equal(restored.phase,'revealed');assert.equal(restored.activeQuiz,null);assert.equal(restored.scores[0][1].score,1);
 restored=restoreHost(JSON.parse(JSON.stringify(restored)),60000);assert.equal(restored.scores[0][1].score,1);
 let next=startHostVoting(restored,songs,[]);next=receiveHostCommand(next,cmd('vote','stale',{round:1,songId:'a'}),60001);assert.deepEqual(next.votes,[]);
});
test('fewer than three voted songs blocks quiz without ending voting, proposals persist and replay rejected',()=>{
 let s=startHostVoting(emptyHost(),songs,[]);s=receiveHostCommand(s,cmd('vote','p',{round:1,songId:'a'}));assert.match(prepareHost(s,songs).error,/3/);
 const suggestion=cmd('suggest','p',{custom:{artist:'Artist',title:'New',url:'https://example.com/new'}});s=receiveHostCommand(s,suggestion);s=restoreHost(JSON.parse(JSON.stringify(s)));assert.equal(s.suggestions.length,1);assert.equal(receiveHostCommand(s,suggestion),s);
 s=receiveHostCommand(s,cmd('vote','bad',{round:1,songId:'unknown'}));assert.equal(s.votes.length,1);
});
test('winner outside queue is inserted and removed from skipped/played before playing',async()=>{
 const calls=[];const fetcher=async(_,init)=>{calls.push(init);return new Response(JSON.stringify(init.method==='GET'?{songs,session:{...session,skipped:['a']},sessionVersion:'v'}:{version:'new'}));};
 await selectHostSong(fetcher,'a',true);const body=JSON.parse(calls[1].body);assert.deepEqual(body.session.queue,['a','d']);assert.equal(body.session.active,'a');assert.deepEqual(body.session.skipped,[]);
});
test('failed proposal catalog or queue writes reject; caller retains proposal for retry',async()=>{
 const s=cmd('suggest','p',{songId:'a'});const host=receiveHostCommand(emptyHost(),s);
 const failQueue=async(_,init)=>new Response(JSON.stringify(init.method==='GET'?{songs,session,sessionVersion:'v'}:{error:'Version conflict'}),{status:init.method==='GET'?200:409});
 await assert.rejects(acceptHostSuggestion(failQueue,s),/Version conflict/);assert.equal(host.suggestions.length,1);
 const failCatalog=async(_,init)=>new Response(JSON.stringify(init.method==='GET'?{songs,session,catalogVersion:'v'}:{error:'Catalog failed'}),{status:init.method==='GET'?200:500});
 await assert.rejects(acceptHostSuggestion(failCatalog,cmd('suggest','custom',{custom:{artist:'New',title:'New',url:'https://example.com/new'}})),/Catalog failed/);
});
test('retry after saved catalog + failed queue does not duplicate custom CSV entry',async()=>{
 const custom={artist:songs[0].artist,title:songs[0].title,url:songs[0].url};const calls=[];
 const fetcher=async(_,init)=>{calls.push(init.method);return new Response(JSON.stringify({songs,session,sessionVersion:'v'}));};
 await acceptHostSuggestion(fetcher,cmd('suggest','p',{custom}));assert.deepEqual(calls,['GET','PUT']);
});
