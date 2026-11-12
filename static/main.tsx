import {createRoot} from 'react-dom/client';
import {installLocalApi} from './local-api';
import '../app/globals.css';

// Патчим fetch до первого рендера: page.tsx обращается к /api/library только из useEffect.
installLocalApi();
const params=new URLSearchParams(location.search);
const roomParam=(params.get('room')||'').toLowerCase().trim();
const isGuest=params.has('guest')||params.get('role')==='guest';
const hasAdminToken=Boolean(roomParam&&localStorage.getItem('nastrunakh.room_admin.'+roomParam)==='1');

const root=createRoot(document.getElementById('root')!);

(async()=>{
 if(roomParam&&isGuest){
  localStorage.setItem('nastrunakh.viewer.room',roomParam);
  const {ViewerApp}=await import('./viewer');
  root.render(<ViewerApp key={roomParam} room={roomParam}/>);
 }else if(roomParam&&hasAdminToken){
  const {AdminShell}=await import('./admin-shell');
  root.render(<AdminShell/>);
 }else if(roomParam){
  localStorage.setItem('nastrunakh.viewer.room',roomParam);
  const {ViewerApp}=await import('./viewer');
  root.render(<ViewerApp key={roomParam} room={roomParam}/>);
 }else{
  const {Gate}=await import('./gate');
  root.render(<Gate lastRoom={localStorage.getItem('nastrunakh.viewer.room')} onAdmin={r=>location.replace('?room='+encodeURIComponent(r))}/>);
 }
})();
