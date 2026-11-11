import {createRoot} from 'react-dom/client';
import {installLocalApi} from './local-api';
import '../app/globals.css';

// Патчим fetch до первого рендера: page.tsx обращается к /api/library только из useEffect.
installLocalApi();
const params=new URLSearchParams(location.search);
const roomParam=(params.get('room')||'').toLowerCase();
const isAdmin=localStorage.getItem('nastrunakh.admin')==='1';
const root=createRoot(document.getElementById('root')!);
// Home статически не импортируем: его тянет только admin-shell, бандл зрителя остаётся лёгким.
(async()=>{
 if(roomParam&&!isAdmin){
  localStorage.setItem('nastrunakh.viewer.room',roomParam);
  const {ViewerApp}=await import('./viewer');
  root.render(<ViewerApp room={roomParam}/>);
 }else if(isAdmin){
  const {AdminShell}=await import('./admin-shell');
  root.render(<AdminShell/>);
 }else{
  const {Gate}=await import('./gate');
  root.render(<Gate lastRoom={localStorage.getItem('nastrunakh.viewer.room')} onAdmin={()=>location.reload()}/>);
 }
})();
