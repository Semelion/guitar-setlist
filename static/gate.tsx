import {useState} from 'react';
import {genParticipantId,genRoom,validRoom} from './room-core';
import './viewer.css';

export function Gate({lastRoom,onAdmin}:{lastRoom:string|null;onAdmin(room:string):void}){
 const [tab,setTab]=useState<'view'|'admin'>('view');
 const [room,setRoom]=useState(lastRoom??'');
 const [adminRoom,setAdminRoom]=useState(()=>genRoom());
 const [name,setName]=useState(()=>localStorage.getItem('nastrunakh.guest_name')??'');
 const [err,setErr]=useState('');

 const joinGuest=()=>{
  const code=room.trim().toLowerCase();
  const guestName=name.trim();
  if(!guestName){setErr('Пожалуйста, введите ваше имя');return;}
  if(!validRoom(code)){setErr('Неверный код комнаты');return;}
  localStorage.setItem('nastrunakh.guest_name',guestName);
  if(!localStorage.getItem('nastrunakh.guest_id')){
   localStorage.setItem('nastrunakh.guest_id',genParticipantId());
  }
  localStorage.setItem('nastrunakh.viewer.room',code);
  location.replace('?room='+encodeURIComponent(code)+'&guest=1');
 };

 const createAdmin=()=>{
  const code=adminRoom.trim().toLowerCase();
  if(!validRoom(code)){setErr('Неверный код комнаты (от 3 до 40 символов: латиница, цифры, дефис)');return;}
  localStorage.setItem('nastrunakh.room_admin.'+code,'1');
  localStorage.setItem('nastrunakh.room',code);
  onAdmin(code);
 };

 return <div className="gate-screen">
  <main className="gate-card">
   <div className="gate-brand">на струнах<i>.</i></div>
   <h1 className="gate-title">Ваш гитарный вечер</h1>
   <p className="gate-sub">Смотрите, голосуйте и угадывайте песни — или создайте комнату и ведите вечер.</p>
   <div className="gate-tabs" aria-label="Вход">
    <button aria-pressed={tab==='view'} className={tab==='view'?'active':''} onClick={()=>{setTab('view');setErr('');}}>Присоединиться (гость)</button>
    <button aria-pressed={tab==='admin'} className={tab==='admin'?'active':''} onClick={()=>{setTab('admin');setErr('');}}>Создать комнату (ведущий)</button>
   </div>
   {tab==='view'?
    <form className="gate-form" onSubmit={e=>{e.preventDefault();joinGuest();}}>
     <label className="gate-label" htmlFor="gate-name">Ваше имя (для квиза и предложений)</label>
     <input id="gate-name" value={name} onChange={e=>{setName(e.target.value);setErr('');}} placeholder="Например, Маша" maxLength={60} autoFocus required autoComplete="name"/>
     <label className="gate-label" htmlFor="gate-room">Код комнаты</label>
     <input id="gate-room" value={room} onChange={e=>{setRoom(e.target.value);setErr('');}} placeholder="vecher-364" autoComplete="off" required/>
     <button className="gate-go" type="submit">Войти к зрителям</button>
    </form>:
    <form className="gate-form" onSubmit={e=>{e.preventDefault();createAdmin();}}>
     <label className="gate-label" htmlFor="gate-admin-room">Код новой комнаты</label>
     <input id="gate-admin-room" value={adminRoom} onChange={e=>{setAdminRoom(e.target.value);setErr('');}} placeholder="koster-123" autoComplete="off" required/>
     <p className="gate-hint">Вы станете ведущим этой комнаты. Пароль не требуется — ссылка на управление сохранится в вашем браузере.</p>
     <button className="gate-go" type="submit">Создать комнату</button>
    </form>}
   {err&&<p className="gate-error" role="alert">{err}</p>}
  </main>
  <footer className="gate-foot">МЕНЬШЕ ВЫБОРА. БОЛЬШЕ МУЗЫКИ.</footer>
 </div>;
}
