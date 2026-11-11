import {useState} from 'react';
import {validRoom} from './room-core';
import './viewer.css';

const ADMIN_PASS='struny';
export function Gate({lastRoom,onAdmin}:{lastRoom:string|null;onAdmin():void}){
 const [tab,setTab]=useState<'view'|'admin'>('view');
 const [room,setRoom]=useState(lastRoom??'');
 const [pass,setPass]=useState('');
 const [err,setErr]=useState('');
 const watch=()=>{
  const code=room.trim().toLowerCase();
  if(!validRoom(code)){setErr('Неверный код комнаты');return;}
  location.replace('?room='+code);
 };
 const login=()=>{
  if(pass.trim().toLowerCase()!==ADMIN_PASS){setErr('Неверный код');return;}
  localStorage.setItem('nastrunakh.admin','1');
  onAdmin();
 };
 return <div className="gate-screen">
  <main className="gate-card">
   <div className="gate-brand">на струнах<i>.</i></div>
   <h1 className="gate-title">Ваш гитарный вечер</h1>
   <p className="gate-sub">Смотрите, что играют сейчас, — или управляйте вечером сами.</p>
   <div className="gate-tabs" aria-label="Вход">
    <button aria-pressed={tab==='view'} className={tab==='view'?'active':''} onClick={()=>{setTab('view');setErr('');}}>Я зритель</button>
    <button aria-pressed={tab==='admin'} className={tab==='admin'?'active':''} onClick={()=>{setTab('admin');setErr('');}}>Вход для админа</button>
   </div>
   {tab==='view'?
    <form className="gate-form" onSubmit={e=>{e.preventDefault();watch();}}>
     <label className="gate-label" htmlFor="gate-room">Код комнаты</label>
     <input id="gate-room" value={room} onChange={e=>{setRoom(e.target.value);setErr('');}} placeholder="vecher-364" autoComplete="off"/>
     <button className="gate-go" type="submit">Смотреть</button>
    </form>:
    <form className="gate-form" onSubmit={e=>{e.preventDefault();login();}}>
     <label className="gate-label" htmlFor="gate-pass">Пароль админа</label>
     <input id="gate-pass" type="password" value={pass} onChange={e=>{setPass(e.target.value);setErr('');}} placeholder="••••••"/>
     <button className="gate-go" type="submit">Войти</button>
    </form>}
   {err&&<p className="gate-error" role="alert">{err}</p>}
  </main>
  <footer className="gate-foot">МЕНЬШЕ ВЫБОРА. БОЛЬШЕ МУЗЫКИ.</footer>
 </div>;
}
