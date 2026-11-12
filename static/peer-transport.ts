// PeerJS cloud is signaling only: room snapshots and commands travel over WebRTC.
// BroadcastChannel is an optional same-origin supplement, never cross-device transport.
import Peer from 'peerjs';
import {genEventId,validateGuestCommand,type GuestCommand,type RoomState} from './room-core.ts';

export type PubStatus='idle'|'ok'|'offline';
export type ViewerStatus='connecting'|'live'|'poll'|'offline';
export type PeerSnapshotMessage={type:'snapshot';state:RoomState;seq:number;ts:number;epoch:string};
export type PeerCommandMessage={type:'command';cmd:GuestCommand;eventId:string};
export type PeerAckMessage={type:'ack';eventId:string;ok:boolean};
export type PeerPingMessage={type:'ping';ts:number};
export type PeerPongMessage={type:'pong';ts:number};
export type PeerTransportMessage=PeerSnapshotMessage|PeerCommandMessage|PeerAckMessage|PeerPingMessage|PeerPongMessage;

export interface IPeerDataConnection{
 readonly peer:string;
 readonly open:boolean;
 send(data:unknown):void;
 close():void;
 on(event:'open'|'close'|'error',cb:(...args:unknown[])=>void):this;
 on(event:'data',cb:(data:unknown)=>void):this;
 off?(event:string,cb?:(...args:unknown[])=>void):this;
}
export interface IPeer{
 readonly id:string;
 readonly destroyed:boolean;
 readonly disconnected:boolean;
 connect(peerId:string,options?:unknown):IPeerDataConnection;
 reconnect():void;
 disconnect():void;
 destroy():void;
 on(event:'open',cb:(id:string)=>void):this;
 on(event:'connection',cb:(conn:IPeerDataConnection)=>void):this;
 on(event:'error',cb:(err:unknown)=>void):this;
 on(event:'close'|'disconnected',cb:()=>void):this;
 off?(event:string,cb?:(...args:unknown[])=>void):this;
}
export type PeerFactory=(id?:string)=>IPeer;
let customPeerFactory:PeerFactory|null=null;
export function setCustomPeerFactory(factory:PeerFactory|null):void{customPeerFactory=factory;}
export function createPeerInstance(id?:string):IPeer{
 if(customPeerFactory)return customPeerFactory(id);
 // Retain PeerJS's bundled ICE/STUN/TURN configuration, including relay support.
 const options={host:'0.peerjs.com',port:443,path:'/',secure:true,debug:1};
 return (id?new Peer(id,options):new Peer(options)) as unknown as IPeer;
}
export function topicToHostPeerId(topic:string):string{
 const base=String(topic||'').trim().toLowerCase().replace(/-cmd$/,'');
 // PeerServer disallows leading/trailing or repeated separators.
 return base.replace(/[^a-z0-9_-]/g,'').replace(/[_-]+/g,'-').replace(/^-|-$/g,'')||'nstrnh-room';
}

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const integer=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v)&&v>=0;
const textValue=(v:unknown,max=2000):v is string=>typeof v==='string'&&v.length<=max;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object';
const oneOf=(v:unknown,values:readonly string[]):boolean=>typeof v==='string'&&values.includes(v);
const song=(v:unknown,url=false):boolean=>isObject(v)&&textValue(v.artist,300)&&textValue(v.title,300)&&(!url||textValue(v.url));
const peerErrorInfo=(err:unknown):{type:string;message:string}=>{
 if(!isObject(err))return{type:'',message:''};
 return{type:typeof err.type==='string'?err.type:'',message:typeof err.message==='string'?err.message:''};
};
function validState(s:unknown):s is RoomState{
 if(!isObject(s)||s.v!==1||!textValue(s.room,200)||!oneOf(s.mode,['select','play'])||!oneOf(s.phase,['idle','voting','quiz','revealed'])||!integer(s.round)||!integer(s.played)||!finite(s.ts))return false;
 if(!(s.active===null||song(s.active,true))||!(s.next===null||song(s.next,true)))return false;
 const queue=s.queue;
 if(!Array.isArray(queue)||queue.length>10000||!queue.every((x:unknown)=>song(x)))return false;
 const leaderboard=s.leaderboard;
 if(!Array.isArray(leaderboard)||leaderboard.length>10000||!leaderboard.every((x:unknown)=>isObject(x)&&textValue(x.participantId,100)&&textValue(x.name,60)&&finite(x.score)))return false;
 for(const key of ['catalog','votingOptions'] as const){
  const list=s[key];
  if(list!==undefined&&(!Array.isArray(list)||list.length>10000||!list.every((x:unknown)=>song(x)&&isObject(x)&&textValue(x.songId,100))))return false;
 }
 if(s.votingTotalVotes!==undefined&&!integer(s.votingTotalVotes))return false;
 const q=s.quiz;
 if(q!==undefined){
  if(!isObject(q)||!integer(q.round)||!finite(q.startedAt)||!finite(q.durationMs)||!finite(q.endsAt)||!Array.isArray(q.options)||q.options.length>100||!q.options.every((x:unknown)=>song(x)&&isObject(x)&&integer(x.index)))return false;
 }
 const r=s.revealed;
 if(r!==undefined){
  if(!isObject(r)||!integer(r.round)||!integer(r.correctOptionIndex)||!song(r.correctSong,true)||!Array.isArray(r.votingResults)||r.votingResults.length>10000||!r.votingResults.every((x:unknown)=>song(x)&&isObject(x)&&textValue(x.songId,100)&&integer(x.votes)))return false;
 }
 return true;
}

export class HostSession{
 readonly hostId:string;
 private peer:IPeer|null=null;
 private activeConns=new Set<IPeerDataConnection>();
 private lastState:RoomState|null=null;
 private seq=0;
 private epoch=genEventId();
 private pubRefCount=0;
 private recvRefCount=0;
 private commandListeners=new Set<(cmd:GuestCommand)=>void>();
 private statusListeners=new Set<(st:ViewerStatus)=>void>();
 private pubStatus:PubStatus='idle';
 private hostStatus:ViewerStatus='connecting';
 private hasCollisionError=false;
 private reconnectTimer:ReturnType<typeof setTimeout>|null=null;
 private bc:BroadcastChannel|null=null;
 private destroyed=false;
 private acceptedCommands=new Set<string>();

 constructor(hostId:string){this.hostId=hostId;this.initBroadcastChannel();this.initPeer();}
 private setStatus(status:ViewerStatus):void{
  this.hostStatus=status;
  this.pubStatus=status==='live'?'ok':status==='connecting'?'idle':'offline';
  for(const cb of this.statusListeners){try{cb(status);}catch{}}
 }
 private scheduleReconnect():void{
  if(this.destroyed||this.hasCollisionError||this.reconnectTimer)return;
  this.reconnectTimer=setTimeout(()=>{
   this.reconnectTimer=null;
   if(this.destroyed||this.hasCollisionError)return;
   if(!this.peer||this.peer.destroyed)this.initPeer();
   else if(this.peer.disconnected){try{this.peer.reconnect();}catch{this.scheduleReconnect();}}
  },2000);
 }
 private initPeer():void{
  if(this.destroyed)return;
  try{
   const peer=createPeerInstance(this.hostId);
   this.peer=peer;
   peer.on('open',()=>{
    if(this.destroyed||this.peer!==peer)return;
    if(this.reconnectTimer){clearTimeout(this.reconnectTimer);this.reconnectTimer=null;}
    this.setStatus('live');
    this.broadcastSnapshot();
   });
   peer.on('error',(err:unknown)=>{
    if(this.destroyed||this.peer!==peer)return;
    const info=peerErrorInfo(err);
    console.warn('Room host transport:',info.type||info.message||'connection failed');
    if(info.type==='unavailable-id'||info.message.includes('is taken')){
     this.hasCollisionError=true;
     for(const conn of this.activeConns){try{conn.close();}catch{}}
     this.activeConns.clear();
     // A rejected host must not continue as a second local authority.
     this.bc?.close();this.bc=null;
    }
    this.setStatus('offline');
    this.scheduleReconnect();
   });
   peer.on('disconnected',()=>{
    if(this.destroyed||this.peer!==peer)return;
    this.setStatus('offline');this.scheduleReconnect();
   });
   peer.on('close',()=>{
    if(this.destroyed||this.peer!==peer)return;
    this.peer=null;this.setStatus('offline');this.scheduleReconnect();
   });
   peer.on('connection',(conn)=>{
    if(this.destroyed||this.hasCollisionError){try{conn.close();}catch{}return;}
    this.activeConns.add(conn);
    let opened=false;
    const onOpen=()=>{
     if(opened||this.destroyed||!this.activeConns.has(conn))return;
     opened=true;
     const snapshot=this.snapshot();
     if(snapshot){try{conn.send(snapshot);}catch{}}
    };
    conn.on('data',raw=>{
     if(this.destroyed||this.hasCollisionError||!this.activeConns.has(conn))return;
     this.receive(raw,msg=>conn.send(msg));
    });
    conn.on('close',()=>this.activeConns.delete(conn));
    conn.on('error',()=>{this.activeConns.delete(conn);try{conn.close();}catch{}});
    conn.on('open',onOpen);
    if(conn.open)onOpen();
   });
  }catch{this.setStatus('offline');this.scheduleReconnect();}
 }
 private receive(raw:unknown,reply:(msg:PeerTransportMessage)=>void):void{
  if(!isObject(raw))return;
  if(raw.type==='command'){
   const valid=validateGuestCommand(raw.cmd);
   let ok=false;
   if(valid&&raw.eventId===valid.eventId&&this.commandListeners.size){
    const key=valid.participantId+'\0'+valid.eventId;
    ok=this.acceptedCommands.has(key);
    if(!ok){
     ok=true;
     for(const cb of this.commandListeners){try{cb(valid);}catch(e){ok=false;console.error('Host onCommand error:',e);}}
     if(ok){
      this.acceptedCommands.add(key);
      if(this.acceptedCommands.size>2000)this.acceptedCommands.delete(this.acceptedCommands.values().next().value!);
     }
    }
   }
   if(textValue(raw.eventId,100)){try{reply({type:'ack',eventId:raw.eventId,ok});}catch{}}
  }else if(raw.type==='ping'&&finite(raw.ts)){
   try{reply({type:'pong',ts:raw.ts});}catch{}
  }else if(raw.type==='hello'){
   const snapshot=this.snapshot();
   if(snapshot){try{reply(snapshot);}catch{}}
  }
 }
 private initBroadcastChannel():void{
  if(typeof BroadcastChannel==='undefined')return;
  try{
   this.bc=new BroadcastChannel('bc-peer-'+this.hostId);
   this.bc.onmessage=e=>{
    if(!this.destroyed&&!this.hasCollisionError)this.receive(e.data,msg=>this.bc?.postMessage(msg));
   };
  }catch{}
 }
 private snapshot():PeerSnapshotMessage|null{
  return this.lastState?{type:'snapshot',state:this.lastState,seq:this.seq,ts:this.lastState.ts,epoch:this.epoch}:null;
 }
 private broadcastSnapshot():void{
  if(this.destroyed||this.hasCollisionError)return;
  const msg=this.snapshot();if(!msg)return;
  for(const conn of this.activeConns)if(conn.open){try{conn.send(msg);}catch{}}
  try{this.bc?.postMessage(msg);}catch{}
 }
 addPublisherRef():void{this.pubRefCount++;}
 removePublisherRef():void{this.pubRefCount=Math.max(0,this.pubRefCount-1);this.checkCleanup();}
 addReceiverRef(onCommand:(cmd:GuestCommand)=>void,onStatus?:(st:ViewerStatus)=>void):()=>void{
  this.recvRefCount++;this.commandListeners.add(onCommand);
  if(onStatus){this.statusListeners.add(onStatus);onStatus(this.hostStatus);}
  let removed=false;
  return ()=>{
   if(removed)return;removed=true;
   this.commandListeners.delete(onCommand);if(onStatus)this.statusListeners.delete(onStatus);
   this.recvRefCount--;this.checkCleanup();
  };
 }
 publish(rs:RoomState):void{
  if(this.destroyed||!validState(rs))return;
  this.lastState=rs;this.seq++;this.broadcastSnapshot();
 }
 getPubStatus():PubStatus{return this.pubStatus;}
 getHostStatus():ViewerStatus{return this.hostStatus;}
 private checkCleanup():void{if(!this.pubRefCount&&!this.recvRefCount)this.destroy();}
 destroy():void{
  if(this.destroyed)return;this.destroyed=true;
  if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
  for(const conn of this.activeConns){try{conn.close();}catch{}}
  this.activeConns.clear();try{this.peer?.destroy();}catch{}this.peer=null;
  try{this.bc?.close();}catch{}this.bc=null;
  this.commandListeners.clear();this.statusListeners.clear();
  if(hostSessions.get(this.hostId)===this)hostSessions.delete(this.hostId);
 }
}

export class GuestSession{
 readonly hostId:string;
 private guestPeer:IPeer|null=null;
 private activeConn:IPeerDataConnection|null=null;
 private viewerRefCount=0;
 private senderRefCount=0;
 private stateListeners=new Set<(rs:RoomState)=>void>();
 private statusListeners=new Set<(st:ViewerStatus)=>void>();
 private guestStatus:ViewerStatus='connecting';
 private lastStateTs=-Infinity;
 private lastStateSeq=-1;
 private lastEpoch:string|null=null;
 private retiredEpochs=new Set<string>();
 private lastState:RoomState|null=null;
 private backoffMs=1000;
 private reconnectTimer:ReturnType<typeof setTimeout>|null=null;
 private connectTimer:ReturnType<typeof setTimeout>|null=null;
 private heartbeatTimer:ReturnType<typeof setInterval>|null=null;
 private lastActivityTs=0;
 private lastLocalActivityTs=0;
 private pendingAcks=new Map<string,{resolve:(ok:boolean)=>void;timer:ReturnType<typeof setTimeout>;promise:Promise<boolean>;local:boolean}>();
 private bc:BroadcastChannel|null=null;
 private destroyed=false;
 constructor(hostId:string){this.hostId=hostId;this.initBroadcastChannel();this.initPeerAndConnect();this.startHeartbeat();}
 private setStatus(s:ViewerStatus):void{
  if(this.guestStatus===s)return;
  this.guestStatus=s;for(const cb of this.statusListeners){try{cb(s);}catch{}}
 }
 private localAlive():boolean{return !!this.lastLocalActivityTs&&Date.now()-this.lastLocalActivityTs<15000;}
 private initBroadcastChannel():void{
  if(typeof BroadcastChannel==='undefined')return;
  try{
   this.bc=new BroadcastChannel('bc-peer-'+this.hostId);
   this.bc.onmessage=e=>{if(!this.destroyed)this.receive(e.data,true);};
   this.bc.postMessage({type:'hello'});
   this.bc.postMessage({type:'ping',ts:Date.now()});
  }catch{}
 }
 private receive(raw:unknown,local:boolean):void{
  if(!isObject(raw))return;
  if(raw.type==='snapshot'){
   const state=raw.state,ts=raw.ts,seq=raw.seq,epoch=raw.epoch;
   if(!validState(state)||!finite(ts)||ts!==state.ts||!integer(seq)||!textValue(epoch,100)||!epoch)return;
   if(this.retiredEpochs.has(epoch))return;
   if(this.lastEpoch!==epoch){
    if(this.lastEpoch)this.retiredEpochs.add(this.lastEpoch);
    this.lastEpoch=epoch;this.lastStateSeq=-1;this.lastStateTs=-Infinity;
   }
   if(seq<=this.lastStateSeq||ts<this.lastStateTs)return;
   this.lastStateTs=ts;this.lastStateSeq=seq;this.lastState=state;
   for(const cb of this.stateListeners){try{cb(state);}catch{}}
  }else if(raw.type==='ack'){
   const eventId=raw.eventId,ok=raw.ok;
   if(typeof eventId!=='string'||typeof ok!=='boolean')return;
   const pending=this.pendingAcks.get(eventId);
   if(!pending||pending.local!==local)return;
   clearTimeout(pending.timer);this.pendingAcks.delete(eventId);pending.resolve(ok);
  }else if(raw.type==='pong'){
   if(!finite(raw.ts))return;
  }else return;
  if(local){
   this.lastLocalActivityTs=Date.now();
   if(!this.activeConn?.open)this.setStatus('poll');
  }else{this.lastActivityTs=Date.now();this.setStatus('live');}
 }
 private initPeerAndConnect():void{
  if(this.destroyed)return;
  try{
   const peer=createPeerInstance();this.guestPeer=peer;
   peer.on('open',()=>{if(!this.destroyed&&this.guestPeer===peer)this.connectToHost();});
   peer.on('error',(err:unknown)=>{
    if(this.destroyed||this.guestPeer!==peer)return;
    const info=peerErrorInfo(err);
    console.warn('Room guest transport:',info.type||info.message||'connection failed');
    this.handleDisconnect();
   });
   peer.on('disconnected',()=>{
    if(this.destroyed||this.guestPeer!==peer)return;
    // Signaling loss need not interrupt an established data channel.
    if(!this.activeConn?.open)this.handleDisconnect();
    else this.scheduleReconnect();
   });
   peer.on('close',()=>{
    if(this.destroyed||this.guestPeer!==peer)return;
    this.guestPeer=null;this.handleDisconnect();
   });
   this.armConnectTimeout();
  }catch{this.handleDisconnect();}
 }
 private armConnectTimeout():void{
  if(this.connectTimer)clearTimeout(this.connectTimer);
  this.connectTimer=setTimeout(()=>{
   this.connectTimer=null;
   if(!this.destroyed&&!this.activeConn?.open)this.handleDisconnect();
  },12000);
 }
 private connectToHost():void{
  if(this.destroyed||!this.guestPeer||this.activeConn)return;
  try{
   const conn=this.guestPeer.connect(this.hostId,{reliable:true});this.activeConn=conn;
   this.armConnectTimeout();
   const onOpen=()=>{
    if(this.destroyed||this.activeConn!==conn)return;
    if(this.connectTimer){clearTimeout(this.connectTimer);this.connectTimer=null;}
    if(this.reconnectTimer){clearTimeout(this.reconnectTimer);this.reconnectTimer=null;}
    this.backoffMs=1000;this.lastActivityTs=Date.now();this.setStatus('live');
    try{conn.send({type:'ping',ts:Date.now()});}catch{this.handleDisconnect();}
   };
   conn.on('data',raw=>{
    if(this.destroyed||this.activeConn!==conn)return;
    if(isObject(raw)&&raw.type==='ping'){
     const ts=raw.ts;
     if(finite(ts)){try{conn.send({type:'pong',ts});}catch{}return;}
    }
    this.receive(raw,false);
   });
   conn.on('close',()=>{if(this.activeConn===conn)this.handleDisconnect();});
   conn.on('error',()=>{if(this.activeConn===conn)this.handleDisconnect();});
   conn.on('open',onOpen);if(conn.open)onOpen();
  }catch{this.handleDisconnect();}
 }
 private startHeartbeat():void{
  this.heartbeatTimer=setInterval(()=>{
   if(this.destroyed)return;
   const now=Date.now();
   try{this.bc?.postMessage({type:'ping',ts:now});}catch{}
   if(this.activeConn?.open){
    if(now-this.lastActivityTs>15000)this.handleDisconnect();
    else try{this.activeConn.send({type:'ping',ts:now});}catch{this.handleDisconnect();}
   }else if(!this.localAlive())this.setStatus('offline');
  },5000);
 }
 private handleDisconnect():void{
  if(this.destroyed)return;
  const conn=this.activeConn;this.activeConn=null;
  // Clear the pointer before close, whose close event can be synchronous.
  if(conn){try{conn.close();}catch{}}
  if(this.connectTimer){clearTimeout(this.connectTimer);this.connectTimer=null;}
  for(const [id,pending] of this.pendingAcks)if(!pending.local){
   clearTimeout(pending.timer);this.pendingAcks.delete(id);pending.resolve(false);
  }
  this.setStatus(this.localAlive()?'poll':'offline');this.scheduleReconnect();
 }
 private scheduleReconnect():void{
  if(this.destroyed||this.reconnectTimer)return;
  const delay=this.backoffMs;this.backoffMs=Math.min(this.backoffMs*2,8000);
  this.reconnectTimer=setTimeout(()=>{
   this.reconnectTimer=null;if(this.destroyed)return;
   if(!this.guestPeer||this.guestPeer.destroyed)this.initPeerAndConnect();
   else if(this.guestPeer.disconnected){
    try{this.guestPeer.reconnect();this.armConnectTimeout();}catch{this.handleDisconnect();}
   }else this.connectToHost();
  },delay);
 }
 addViewerRef(onState:(rs:RoomState)=>void,onStatus:(st:ViewerStatus)=>void):()=>void{
  this.viewerRefCount++;this.stateListeners.add(onState);this.statusListeners.add(onStatus);
  onStatus(this.guestStatus);if(this.lastState){try{onState(this.lastState);}catch{}}
  let removed=false;
  return ()=>{
   if(removed)return;removed=true;
   this.stateListeners.delete(onState);this.statusListeners.delete(onStatus);this.viewerRefCount--;this.checkCleanup();
  };
 }
 addSenderRef():void{this.senderRefCount++;}
 removeSenderRef():void{this.senderRefCount=Math.max(0,this.senderRefCount-1);this.checkCleanup();}
 sendCommand(cmd:GuestCommand):Promise<boolean>{
  const valid=validateGuestCommand(cmd);
  if(this.destroyed||!valid)return Promise.resolve(false);
  const local=!this.activeConn?.open;
  if(local&&(!this.bc||!this.localAlive()))return Promise.resolve(false);
  const existing=this.pendingAcks.get(valid.eventId);if(existing)return existing.promise;
  let resolve!:(ok:boolean)=>void;
  const promise=new Promise<boolean>(done=>{resolve=done;});
  const timer=setTimeout(()=>{this.pendingAcks.delete(valid.eventId);resolve(false);},4000);
  this.pendingAcks.set(valid.eventId,{resolve,timer,promise,local});
  try{
   const msg:PeerCommandMessage={type:'command',cmd:valid,eventId:valid.eventId};
   if(local)this.bc!.postMessage(msg);else this.activeConn!.send(msg);
  }catch{clearTimeout(timer);this.pendingAcks.delete(valid.eventId);resolve(false);}
  return promise;
 }
 private checkCleanup():void{if(!this.viewerRefCount&&!this.senderRefCount)this.destroy();}
 destroy():void{
  if(this.destroyed)return;this.destroyed=true;
  if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
  if(this.connectTimer)clearTimeout(this.connectTimer);
  if(this.heartbeatTimer)clearInterval(this.heartbeatTimer);
  for(const pending of this.pendingAcks.values()){clearTimeout(pending.timer);pending.resolve(false);}this.pendingAcks.clear();
  const conn=this.activeConn;this.activeConn=null;try{conn?.close();}catch{}
  try{this.guestPeer?.destroy();}catch{}this.guestPeer=null;
  try{this.bc?.close();}catch{}this.bc=null;
  this.stateListeners.clear();this.statusListeners.clear();
  if(guestSessions.get(this.hostId)===this)guestSessions.delete(this.hostId);
 }
}
const hostSessions=new Map<string,HostSession>();
const guestSessions=new Map<string,GuestSession>();
export function getOrCreateHostSession(topic:string):HostSession{
 const id=topicToHostPeerId(topic);let session=hostSessions.get(id);
 if(!session){session=new HostSession(id);hostSessions.set(id,session);}return session;
}
export function getOrCreateGuestSession(topic:string):GuestSession{
 const id=topicToHostPeerId(topic);let session=guestSessions.get(id);
 if(!session){session=new GuestSession(id);guestSessions.set(id,session);}return session;
}
export function clearAllSessionsForTest():void{
 for(const session of [...hostSessions.values()])session.destroy();
 for(const session of [...guestSessions.values()])session.destroy();
 hostSessions.clear();guestSessions.clear();
}
