import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoomState,roomTopic,genRoom,validRoom,parseNtfyPoll,parseNtfyEvent} from '../static/room-core.ts';

const songs=[
 {id:'s1',artist:'Король и Шут',title:'Кукла колдуна',category:'ru',priority:true,url:'https://x/1',extra_url:'',resource_type:'chords'},
 {id:'s2',artist:'ДДТ',title:'Что такое осень',category:'ru',priority:false,url:'https://x/2',extra_url:'',resource_type:'chords'},
 {id:'s3',artist:'Сплин',title:'Выхода нет',category:'ru',priority:false,url:'https://x/3',extra_url:'',resource_type:'chords'},
];
const app=(mode,session)=>({mode,session,songs,ready:true});
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
test('buildRoomState: ids missing from songs are ignored',()=>{
 const rs=buildRoomState('r',app('play',{queue:['ghost','s2'],skipped:[],played:[],active:'ghost'}));
 assert.equal(rs.active,null);
 assert.deepEqual(rs.next,{artist:'ДДТ',title:'Что такое осень',url:'https://x/2'});
 assert.deepEqual(rs.queue,[]);
});
test('roomTopic: prefix nstrnh- and sanitization to [a-z0-9-]',()=>{
 const topic=roomTopic('VecheR 364!');
 assert.equal(topic,'nstrnh-vecher364');
 assert.ok(topic.startsWith('nstrnh-'));
 assert.match(topic.slice('nstrnh-'.length),/^[a-z0-9-]+$/);
 assert.equal(roomTopic('vecher-364'),'nstrnh-vecher-364');
});
test('genRoom: word-NNN from the list, 20 calls all valid',()=>{
 const words=['vecher','koster','struny','dvor','lampa','kvartal','pesnya','ogni'];
 for(let i=0;i<20;i++){
  const g=genRoom();
  assert.match(g,/^[a-z]+-[0-9]{3}$/);
  assert.ok(words.includes(g.split('-')[0]));
  assert.equal(validRoom(g),true);
 }
});
test('validRoom: /^[a-z0-9-]{3,40}$/ — 3 true, 4 false',()=>{
 assert.equal(validRoom('vecher-364'),true);
 assert.equal(validRoom('abc'),true);
 assert.equal(validRoom('k0ster-007'),true);
 assert.equal(validRoom('ab'),false);
 assert.equal(validRoom('VecheR'),false);
 assert.equal(validRoom('room 1!'),false);
 assert.equal(validRoom('x'.repeat(41)),false);
});
const rs=(room,v=1)=>({v,room,mode:'play',active:null,next:null,queue:[],played:0,ts:1});
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
