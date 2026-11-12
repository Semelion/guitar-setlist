// Браузерный слой комнат через PeerJS / WebRTC data connections:
// - createPublisher: публикация RoomState хостом-админом через WebRTC DataConnections + BroadcastChannel
// - createViewer: приём RoomState зрителями напрямую от хоста
// - createCommandSender: надёжная отправка команд гостем хосту с подтверждением (Transport ACK)
// - createCommandReceiver: приём команд гостей хостом-админом
import {
 getOrCreateGuestSession,
 getOrCreateHostSession,
 type PubStatus,
 type ViewerStatus,
} from './peer-transport.ts';
import type {GuestCommand,RoomState} from './room-core.ts';

export const NTFY='https://ntfy.sh';
export const PUBLISH_DEBOUNCE=150;
export const POLL_INTERVAL=5000;
export type {PubStatus,ViewerStatus};

export function createPublisher(topic:string):{
 publish(rs:RoomState):void;
 status():PubStatus;
 close():void;
}{
 const host=getOrCreateHostSession(topic);
 host.addPublisherRef();
 let timer:ReturnType<typeof setTimeout>|null=null;
 let last:RoomState|null=null;
 let closed=false;

 const flush=()=>{
  timer=null;
  if(closed||!last)return;
  host.publish(last);
 };

 return {
  publish(rs:RoomState){
   if(closed)return;
   last=rs;
   if(timer)clearTimeout(timer);
   timer=setTimeout(flush,PUBLISH_DEBOUNCE);
  },
  status(){
   return host.getPubStatus();
  },
  close(){
   if(closed)return;
   closed=true;
   if(timer){
    clearTimeout(timer);
    timer=null;
   }
   host.removePublisherRef();
  },
 };
}

export function createViewer(
 topic:string,
 onState:(rs:RoomState)=>void,
 onStatus:(s:ViewerStatus)=>void
):{close():void}{
 const guest=getOrCreateGuestSession(topic);
 let closed=false;
 const unsubscribe=guest.addViewerRef(
  (rs)=>{
   if(!closed)onState(rs);
  },
  (st)=>{
   if(!closed)onStatus(st);
  }
 );

 return {
  close(){
   if(closed)return;
   closed=true;
   unsubscribe();
  },
 };
}

export function createCommandSender(cmdTopic:string):{
 send(cmd:GuestCommand):Promise<boolean>;
 close():void;
}{
 const guest=getOrCreateGuestSession(cmdTopic);
 guest.addSenderRef();
 let closed=false;

 return {
  async send(cmd:GuestCommand):Promise<boolean>{
   if(closed)return false;
   return guest.sendCommand(cmd);
  },
  close(){
   if(closed)return;
   closed=true;
   guest.removeSenderRef();
  },
 };
}

export function createCommandReceiver(
 cmdTopic:string,
 onCommand:(cmd:GuestCommand)=>void,
 onStatus?:(s:ViewerStatus)=>void
):{close():void}{
 const host=getOrCreateHostSession(cmdTopic);
 let closed=false;
 const unsubscribe=host.addReceiverRef(
  (cmd)=>{
   if(!closed)onCommand(cmd);
  },
  (st)=>{
   if(!closed&&onStatus)onStatus(st);
  }
 );

 return {
  close(){
   if(closed)return;
   closed=true;
   unsubscribe();
  },
 };
}
