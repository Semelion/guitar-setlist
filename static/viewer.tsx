import {useEffect,useState} from 'react';
import {createViewer} from './room-client';
import {roomTopic,type RoomState} from './room-core';
import './viewer.css';

type VStatus='connecting'|'live'|'poll'|'offline';
const stText:Record<VStatus,string>={connecting:'подключение…',live:'в эфире',poll:'обновление…',offline:'нет связи'};

export function ViewerApp({room}:{room:string}){
 const [rs,setRs]=useState<RoomState|null>(null);
 const [status,setStatus]=useState<VStatus>('connecting');
 useEffect(()=>{
  const v=createViewer(roomTopic(room),setRs,setStatus);
  return()=>v.close();
 },[room]);
 const song=rs?rs.active??(rs.mode==='play'?rs.next:null):null;
 const label=rs?.active?'СЕЙЧАС ИГРАЕМ':song?'СЛЕДУЮЩАЯ':'ИДЁТ ОТБОР ПЕСЕН';
 return <div className="v-page">
  <header className="v-top">
   <span className="v-brand">на струнах<i>.</i></span>
   <span className="v-room">{room}</span>
   <span className={'v-status '+status} title={stText[status]}><i/>{stText[status]}</span>
  </header>
  <main className="v-main">
   {!rs?<div className="v-empty"><h1>Ждём начала вечера…</h1><p>Код комнаты проверен?</p></div>:<>
    <section className={'v-card'+(rs.active?' now':'')} aria-label="Текущая песня">
     <span className="v-label">{label}{rs.active&&<span className="v-eq" aria-hidden="true"><i/><i/><i/></span>}</span>
     {song?<div className="v-song">
      <span className="v-artist">{song.artist}</span>
      <h1 className="v-title">{song.title}</h1>
      <a className="v-link" href={song.url} target="_blank" rel="noopener noreferrer">Текст и аккорды ↗</a>
     </div>:<p className="v-pick">Админ выбирает песни — здесь появится первая из них.</p>}
    </section>
    {rs.queue.length>0&&<section className="v-queue" aria-label="Очередь">
     <h2>Дальше по списку · {rs.queue.length}</h2>
     <ol>{rs.queue.slice(0,12).map((q,i)=><li key={i}><span className="v-num">{String(i+1).padStart(2,'0')}</span><span className="v-qtext"><strong>{q.title}</strong><small>{q.artist}</small></span></li>)}</ol>
    </section>}
    <footer className="v-foot"><span>Сыграно за вечер: {rs.played}</span><span>Обновлено {new Date(rs.ts).toLocaleTimeString('ru-RU')}</span></footer>
   </>}
  </main>
 </div>;
}
