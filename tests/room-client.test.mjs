import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {
 clearAllSessionsForTest,
 getOrCreateGuestSession,
 getOrCreateHostSession,
 setCustomPeerFactory,
 topicToHostPeerId,
} from '../static/peer-transport.ts';
import {
 createCommandReceiver,
 createCommandSender,
 createPublisher,
 createViewer,
} from '../static/room-client.ts';

const nativeBroadcastChannel=globalThis.BroadcastChannel;
beforeEach(()=>{globalThis.BroadcastChannel=undefined;});
afterEach(()=>{clearAllSessionsForTest();setCustomPeerFactory(null);globalThis.BroadcastChannel=nativeBroadcastChannel;});

class FakeDataConnection{
 constructor(peerId,remotePeerId,network){
  this.peer=remotePeerId;
  this.remotePeerId=remotePeerId;
  this.myPeerId=peerId;
  this.network=network;
  this.open=false;
  this.closed=false;
  this.partner=null;
  this.listeners=new Map();
 }

 on(event,cb){
  if(!this.listeners.has(event))this.listeners.set(event,new Set());
  this.listeners.get(event).add(cb);
  return this;
 }

 emit(event,...args){
  const cbs=this.listeners.get(event);
  if(cbs){
   for(const cb of Array.from(cbs)){
    try{cb(...args);}catch(e){console.error(e);}
   }
  }
 }

 send(data){
  if(!this.open||!this.partner||!this.partner.open){
   throw new Error('Connection is not open');
  }
  const cloned=JSON.parse(JSON.stringify(data));
  this.network.messages.push(cloned);
  setTimeout(()=>{
   if(this.partner&&this.partner.open){
    this.partner.emit('data',cloned);
   }
  },5);
 }

 close(){
  if(this.closed)return;
  this.closed=true;
  this.open=false;
  this.emit('close');
  if(this.partner&&this.partner.open){
   this.partner.closed=true;
   this.partner.open=false;
   this.partner.emit('close');
  }
 }
}

class FakePeer{
 constructor(id,network){
  this.id=id||'guest-'+Math.random().toString(36).slice(2,8);
  this.network=network;
  this.destroyed=false;
  this.disconnected=false;
  this.listeners=new Map();
  this.connections=new Set();

  setTimeout(()=>{
   if(this.destroyed)return;
   if(id&&network.peers.has(id)){
    this.emit('error',{type:'unavailable-id',message:`ID "${id}" is taken`});
   }else{
    if(id)network.peers.set(id,this);
    this.emit('open',this.id);
   }
  },5);
 }

 on(event,cb){
  if(!this.listeners.has(event))this.listeners.set(event,new Set());
  this.listeners.get(event).add(cb);
  return this;
 }

 emit(event,...args){
  const cbs=this.listeners.get(event);
  if(cbs){
   for(const cb of Array.from(cbs)){
    try{cb(...args);}catch(e){console.error(e);}
   }
  }
 }

 connect(targetId){
  const guestConn=new FakeDataConnection(this.id,targetId,this.network);
  const hostPeer=this.network.peers.get(targetId);
  this.connections.add(guestConn);

  setTimeout(()=>{
   if(this.destroyed||guestConn.closed||guestConn.open)return;
   if(hostPeer&&!hostPeer.destroyed){
    const hostConn=new FakeDataConnection(targetId,this.id,this.network);
    hostPeer.connections.add(hostConn);
    guestConn.partner=hostConn;
    hostConn.partner=guestConn;
    guestConn.open=true;
    hostConn.open=true;
    hostPeer.emit('connection',hostConn);
    setTimeout(()=>{
     hostConn.emit('open');
     guestConn.emit('open');
    },5);
   }else{
    guestConn.emit('error',new Error('peer-unavailable'));
    guestConn.emit('close');
   }
  },10);

  return guestConn;
 }

 reconnect(){
  this.disconnected=false;
  setTimeout(()=>{if(!this.destroyed)this.emit('open',this.id);},5);
 }

 disconnect(){
  this.disconnected=true;
  this.emit('disconnected');
 }

 destroy(){
  this.destroyed=true;
  for(const conn of this.connections)conn.close();
  if(this.network.peers.get(this.id)===this){
   this.network.peers.delete(this.id);
  }
  this.emit('close');
 }
}

class FakeNetwork{
 constructor(){
  this.peers=new Map();
  this.messages=[];
 }

 createPeer(id){
  return new FakePeer(id,this);
 }

 reset(){
  for(const peer of Array.from(this.peers.values())){
   peer.destroy();
  }
  this.peers.clear();
 }
}

function delay(ms){
 return new Promise(resolve=>setTimeout(resolve,ms));
}

async function waitUntil(predicate,timeoutMs=2500,intervalMs=10){
 const start=Date.now();
 while(Date.now()-start<timeoutMs){
  if(predicate())return true;
  await delay(intervalMs);
 }
 return predicate();
}

test('topicToHostPeerId: sanitization and cmd suffix stripping',()=>{
 assert.equal(topicToHostPeerId('nstrnh-vecher-123'),'nstrnh-vecher-123');
 assert.equal(topicToHostPeerId('nstrnh-vecher-123-cmd'),'nstrnh-vecher-123');
 assert.equal(topicToHostPeerId('NSTRNH-KOSTER-456-CMD'),'nstrnh-koster-456');
 assert.equal(topicToHostPeerId('room!@#$$%^123'),'room123');
});

test('Publisher & Viewer: connect, state broadcast, and immediate cached snapshot for new guests',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const topic='nstrnh-test-room-1';
 const pub=createPublisher(topic);

 const receivedStates=[];
 const receivedStatuses=[];
 const viewer1=createViewer(topic,(rs)=>receivedStates.push(rs),(st)=>receivedStatuses.push(st));

 await waitUntil(()=>receivedStatuses.includes('live'),1000);
 assert.ok(receivedStatuses.includes('live'),'must establish actual data transport without BroadcastChannel');

 const sampleState={
  v:1,
  room:'test-room-1',
  mode:'play',
  phase:'idle',
  round:1,
  active:{artist:'Кино',title:'Группа крови',url:'https://x/1'},
  next:null,
  queue:[],
  played:0,
  ts:Date.now(),
  leaderboard:[],
 };

 pub.publish(sampleState);
 await waitUntil(()=>receivedStates.length>=1,1000);

 assert.equal(receivedStates.length,1);
 assert.equal(receivedStates[0].room,'test-room-1');
 assert.equal(receivedStates[0].active.artist,'Кино');

 // New viewer connecting later must immediately receive the cached RoomState
 const lateStates=[];
 const viewer2=createViewer(topic,(rs)=>lateStates.push(rs),()=>{});
 await waitUntil(()=>lateStates.length>=1,1000);

 assert.equal(lateStates.length,1);
 assert.equal(lateStates[0].active.title,'Группа крови');

 pub.close();
 viewer1.close();
 viewer2.close();
 clearAllSessionsForTest();
});

test('CommandSender & CommandReceiver: DTLS P2P delivery with Transport ACK',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const cmdTopic='nstrnh-test-room-2-cmd';
 const receivedCommands=[];
 const receiver=createCommandReceiver(cmdTopic,(cmd)=>receivedCommands.push(cmd));

 const sender=createCommandSender(cmdTopic);

 // Wait for viewer/sender peer to connect to host
 await waitUntil(()=>network.peers.get('nstrnh-test-room-2')?.connections.size>0&&[...network.peers.get('nstrnh-test-room-2').connections][0]?.open,1000);

 const validVote={
  v:1,
  eventId:'ev-101',
  participantId:'p-guest-1',
  participantName:'Алиса',
  type:'vote',
  ts:Date.now(),
  round:1,
  songId:'song-42',
 };

 const ok=await sender.send(validVote);
 assert.equal(ok,true,'Transport ACK should return true for valid command');
 await waitUntil(()=>receivedCommands.length>=1,1000);
 assert.equal(receivedCommands.length,1);
 assert.equal(receivedCommands[0].participantName,'Алиса');
 assert.equal(receivedCommands[0].songId,'song-42');

 sender.close();
 receiver.close();
 clearAllSessionsForTest();
});

test('CommandSender: fails and returns false when host is offline / unreachable',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const sender=createCommandSender('nstrnh-nonexistent-host-cmd');
 await delay(30);

 const cmd={
  v:1,
  eventId:'ev-999',
  participantId:'p-nobody',
  participantName:'Боб',
  type:'vote',
  ts:Date.now(),
  round:1,
  songId:'s1',
 };

 const ok=await sender.send(cmd);
 assert.equal(ok,false,'Must not falsely claim success when host is unreachable');

 sender.close();
 clearAllSessionsForTest();
});

test('Viewer out-of-order / stale snapshot rejection',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const topic='nstrnh-ordering-test';
 const host=getOrCreateHostSession(topic);
 const guest=getOrCreateGuestSession(topic);

 const received=[];
 guest.addViewerRef((rs)=>received.push(rs),()=>{});
 await waitUntil(()=>network.peers.get('nstrnh-ordering-test')?.connections.size>0&&[...network.peers.get('nstrnh-ordering-test').connections][0]?.open,1000);

 const rs1={v:1,room:'r',mode:'play',phase:'idle',round:1,active:null,next:null,queue:[],played:0,ts:1000,leaderboard:[]};
 const rs2={v:1,room:'r',mode:'play',phase:'idle',round:2,active:null,next:null,queue:[],played:0,ts:2000,leaderboard:[]};
 const rsStale={v:1,room:'r',mode:'play',phase:'idle',round:0,active:null,next:null,queue:[],played:0,ts:500,leaderboard:[]};

 host.publish(rs1);
 await waitUntil(()=>received.length>=1,1000);
 host.publish(rs2);
 await waitUntil(()=>received.length>=2,1000);
 host.publish(rsStale);
 await delay(40);

 assert.equal(received.length,2);
 assert.equal(received[0].round,1);
 assert.equal(received[1].round,2);

 clearAllSessionsForTest();
});

test('Host F5 / restart simulation: guest auto-reconnects and receives new snapshot',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const topic='nstrnh-f5-test';
 let pub=createPublisher(topic);

 const received=[];
 const statuses=[];
 const viewer=createViewer(topic,(rs)=>received.push(rs),(st)=>statuses.push(st));

 await waitUntil(()=>network.peers.get('nstrnh-f5-test')?.connections.size>0&&[...network.peers.get('nstrnh-f5-test').connections][0]?.open,1000);
 pub.publish({v:1,room:'f5',mode:'play',phase:'idle',round:1,active:null,next:null,queue:[],played:0,ts:1000,leaderboard:[]});
 await waitUntil(()=>received.length>=1,1000);

 assert.equal(received.length,1);

 // Simulate Host tab F5: close host session and recreate host peer
 pub.close();
 await waitUntil(()=>statuses.includes('offline'),1000);

 // Host re-opens
 pub=createPublisher(topic);
 await waitUntil(()=>network.peers.has('nstrnh-f5-test'),1000);

 pub.publish({v:1,room:'f5',mode:'play',phase:'idle',round:2,active:null,next:null,queue:[],played:0,ts:500,leaderboard:[]});
 await waitUntil(()=>received.length>=2&&received[received.length-1].round===2,3000);

 assert.equal(received.length,2,'host epoch resets ordering despite lower timestamp and sequence');
 assert.ok(statuses.includes('offline'));
 assert.equal(received[received.length-1].round,2);

 pub.close();
 viewer.close();
 clearAllSessionsForTest();
});

test('Host ID collision: sets status offline and does not silently become guest',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const topic='nstrnh-collision-room';
 const host1=getOrCreateHostSession(topic);
 await waitUntil(()=>network.peers.has('nstrnh-collision-room'),1000);

 const hostStatuses=[];
 const host2=new (host1.constructor)('nstrnh-collision-room');
 host2.addReceiverRef(()=>{},(st)=>hostStatuses.push(st));

 await waitUntil(()=>hostStatuses.includes('offline')&&host2.getPubStatus()==='offline',1000);
 assert.ok(hostStatuses.includes('offline'),'Second host with taken ID must report offline');
 assert.equal(host2.getPubStatus(),'offline');

 host1.destroy();
 host2.destroy();
 clearAllSessionsForTest();
});

test('Singleton refcount & resource cleanup',async()=>{
 const network=new FakeNetwork();
 setCustomPeerFactory(id=>network.createPeer(id));
 clearAllSessionsForTest();

 const topic='nstrnh-cleanup-room';
 const pub=createPublisher(topic);
 const receiver=createCommandReceiver(topic+'-cmd',()=>{});

 const hostId=topicToHostPeerId(topic);
 const host=getOrCreateHostSession(topic);
 assert.equal(host.hostId,hostId);

 pub.close();
 receiver.close();

 // Host session should be destroyed after all refs closed
 assert.equal(network.peers.has(hostId),false);

 clearAllSessionsForTest();
});

const state=(round=1,ts=1000)=>({v:1,room:'r',mode:'play',phase:'idle',round,active:null,next:null,queue:[],played:0,ts,leaderboard:[]});
const vote=(eventId='vote-1')=>({v:1,eventId,participantId:'p1',participantName:'Guest',type:'vote',ts:1000,round:1,songId:'s1'});

function setupNetwork(){
 const network=new FakeNetwork();setCustomPeerFactory(id=>network.createPeer(id));return network;
}

test('one snapshot on connection; duplicate command and simultaneous send get one delivery and ACK',async()=>{
 const network=setupNetwork();
 const host=getOrCreateHostSession('once');host.addPublisherRef();
 const commands=[];const unrecv=host.addReceiverRef(cmd=>commands.push(cmd));
 host.publish(state());
 const received=[];const viewer=createViewer('once',s=>received.push(s),()=>{});
 const sender=createCommandSender('once-cmd');
 await waitUntil(()=>received.length>=1,1000);
 assert.equal(received.length,1,'an already-open connection must not send cache twice');
 assert.equal(network.messages.filter(m=>m.type==='snapshot').length,1);
 const results=await Promise.all([sender.send(vote()),sender.send(vote())]);
 assert.deepEqual(results,[true,true]);
 assert.equal(commands.length,1);
 assert.equal(network.messages.filter(m=>m.type==='ack').length,1);
 assert.equal(await sender.send(vote()),true);
 assert.equal(commands.length,1,'retransmission must not reapply an event');
 sender.close();viewer.close();unrecv();host.removePublisherRef();
});

test('host publisher and guest sender survive closing their other singleton handle',async()=>{
 const network=setupNetwork();
 const pub=createPublisher('refs');const commands=[];
 const receiver=createCommandReceiver('refs-cmd',cmd=>commands.push(cmd));
 const states=[];const viewer=createViewer('refs',s=>states.push(s),()=>{});
 const sender=createCommandSender('refs-cmd');
 await waitUntil(()=>network.peers.get('refs')?.connections.size>0&&[...network.peers.get('refs').connections][0]?.open,1000);
 viewer.close();
 assert.equal(await sender.send(vote()),true,'closing viewer keeps sender transport alive');
 receiver.close();
 pub.publish(state());
 await waitUntil(()=>pub.status()==='ok',1000);
 assert.equal(pub.status(),'ok','closing command receiver keeps publisher alive');
 assert.equal(await sender.send(vote('no-receiver')),false,'without a command consumer ACK must be false');
 pub.close();
 assert.equal(network.peers.has('refs'),false);
 sender.close();
});

test('invalid packets, mismatched command event IDs and fake ACK values are rejected',async()=>{
 const network=setupNetwork();const host=getOrCreateHostSession('validate');host.addPublisherRef();
 const commands=[];host.addReceiverRef(cmd=>commands.push(cmd));
 const received=[];const viewer=createViewer('validate',s=>received.push(s),()=>{});
 const sender=createCommandSender('validate-cmd');
 await waitUntil(()=>network.peers.get('validate')?.connections.size>0&&[...network.peers.get('validate').connections][0]?.open,1000);
 const conn=[...network.peers.get('validate').connections][0];
 conn.send({type:'snapshot',state:{...state(),queue:{}},epoch:'bad',seq:999,ts:1000});
 conn.send({type:'snapshot',state:state(),epoch:'bad',seq:Infinity,ts:1000});
 conn.partner.send({type:'command',cmd:vote(),eventId:'different'});
 await delay(30);assert.equal(received.length,0);assert.equal(commands.length,0);
 host.publish(state());
 await waitUntil(()=>received.length>=1,1000);
 assert.equal(received.length,1);
 assert.equal(await sender.send({...vote(),participantName:''}),false);
 sender.close();viewer.close();
});

test('synchronous close is safe and ignores stale closed connection data',async()=>{
 const network=setupNetwork();const pub=createPublisher('close');
 const received=[];const viewer=createViewer('close',s=>received.push(s),()=>{});
 const sender=createCommandSender('close-cmd');
 await waitUntil(()=>network.peers.get('close')?.connections.size>0&&[...network.peers.get('close').connections][0]?.open,1000);
 const conn=[...network.peers.get('close').connections][0];
 assert.doesNotThrow(()=>conn.close());
 conn.partner.emit('data',{type:'snapshot',state:state(),epoch:'late',seq:1,ts:1000});
 assert.equal(received.length,0);
 assert.equal(await sender.send(vote()),false);
 sender.close();viewer.close();pub.close();
});

class FakeBroadcastChannel{
 static channels=new Set();
 constructor(name){this.name=name;this.onmessage=null;FakeBroadcastChannel.channels.add(this);}
 postMessage(data){
  for(const channel of [...FakeBroadcastChannel.channels])if(channel!==this&&channel.name===this.name){
   const cloned=structuredClone(data);
   setTimeout(()=>{if(FakeBroadcastChannel.channels.has(channel))channel.onmessage?.({data:cloned});},1);
  }
 }
 close(){FakeBroadcastChannel.channels.delete(this);}
}

test('local fallback reports poll, supplies cache and ACKs commands without WebRTC',async()=>{
 globalThis.BroadcastChannel=FakeBroadcastChannel;
 setupNetwork();
 // A signaling outage is distinct from a taken host ID.
 setCustomPeerFactory(()=>{throw new Error('signaling unavailable');});
 const host=getOrCreateHostSession('local');host.addPublisherRef();
 const commands=[];host.addReceiverRef(cmd=>commands.push(cmd));host.publish(state());
 const states=[],statuses=[];
 const viewer=createViewer('local',s=>states.push(s),s=>statuses.push(s));
 const sender=createCommandSender('local-cmd');
 await waitUntil(()=>states.length>=1&&statuses.includes('poll'),1000);
 assert.equal(states.length,1,'hello retrieves cached state from local host');
 assert.ok(statuses.includes('poll'),'local fallback must not claim cross-device live');
 assert.equal(host.getPubStatus(),'offline','local publish must not mask signaling outage');
 assert.equal(await sender.send(vote()),true);assert.equal(commands.length,1);
 sender.close();viewer.close();host.destroy();
 assert.equal(FakeBroadcastChannel.channels.size,0);
});

test('collision host cannot publish local snapshots or evict the real singleton',async()=>{
 globalThis.BroadcastChannel=FakeBroadcastChannel;const network=setupNetwork();
 const host=getOrCreateHostSession('collision-safe');host.addPublisherRef();
 await waitUntil(()=>network.peers.has('collision-safe'),1000);
 const duplicate=new host.constructor('collision-safe');duplicate.addPublisherRef();
 await delay(20);
 const states=[];const viewer=createViewer('collision-safe',s=>states.push(s),()=>{});
 duplicate.publish(state(99));await delay(30);
 assert.equal(states.length,0);
 duplicate.destroy();assert.equal(getOrCreateHostSession('collision-safe'),host);
 host.publish(state(2));
 await waitUntil(()=>states.length>=1&&states.at(-1).round===2,1000);
 assert.equal(states.at(-1).round,2);
 viewer.close();host.destroy();
});

test('host signaling reconnect restores availability without discarding the room',async()=>{
 const network=setupNetwork();const host=getOrCreateHostSession('signaling');host.addPublisherRef();
 await waitUntil(()=>network.peers.has('signaling')&&host.getPubStatus()==='ok',1000);
 const peer=network.peers.get('signaling');
 peer.disconnect();assert.equal(host.getPubStatus(),'offline');
 host.publish(state());assert.equal(host.getPubStatus(),'offline');
 await waitUntil(()=>peer.disconnected===false&&host.getPubStatus()==='ok',3500);
 assert.equal(peer.disconnected,false);assert.equal(host.getPubStatus(),'ok');
 host.destroy();
});
