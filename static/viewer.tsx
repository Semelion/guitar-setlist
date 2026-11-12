import {useEffect,useRef,useState} from 'react';
import {createCommandSender,createViewer,type ViewerStatus} from './room-client';
import {
 genEventId,
 genParticipantId,
 roomCmdTopic,
 roomTopic,
 type GuestCommand,
 type RoomState,
} from './room-core';
import './viewer.css';

const stText:Record<ViewerStatus,string>={
 connecting:'подключение…',
 live:'в эфире',
 poll:'обновление…',
 offline:'нет связи',
};

export function ViewerApp({room}:{room:string}){
 const [rs,setRs]=useState<RoomState|null>(null);
 const [status,setStatus]=useState<ViewerStatus>('connecting');

 // Guest identity
 const [guestId]=useState(()=>{
  let id=localStorage.getItem('nastrunakh.guest_id');
  if(!id){id=genParticipantId();localStorage.setItem('nastrunakh.guest_id',id);}
  return id;
 });
 const [guestName,setGuestName]=useState(()=>localStorage.getItem('nastrunakh.guest_name')??'');
 const [nameInput,setNameInput]=useState('');

 // Interactivity state with sessionStorage F5 persistence
 const [myVote,setMyVote]=useState<{round:number;songId:string}|null>(null);
 const [myAnswer,setMyAnswer]=useState<{round:number;optionIndex:number}|null>(null);
 const [suggestModal,setSuggestModal]=useState(false);
 const [catalogChoice,setCatalogChoice]=useState('');
 const [customArtist,setCustomArtist]=useState('');
 const [customTitle,setCustomTitle]=useState('');
 const [customUrl,setCustomUrl]=useState('');
 const [customCat,setCustomCat]=useState('ru');
 const [suggestNotice,setSuggestNotice]=useState('');
 const [timeLeft,setTimeLeft]=useState<number|null>(null);

 const cmdSenderRef=useRef<ReturnType<typeof createCommandSender>|null>(null);

 useEffect(()=>{
  setRs(null);setMyVote(null);setMyAnswer(null);
  cmdSenderRef.current=createCommandSender(roomCmdTopic(room));
  const v=createViewer(roomTopic(room),setRs,setStatus);
  return()=>{v.close();(cmdSenderRef.current as {close?:()=>void}|null)?.close?.();cmdSenderRef.current=null;};
 },[room]);

 // Restore myVote and myAnswer from sessionStorage when rs updates
 useEffect(()=>{
  if(!rs)return;
  // Restore vote for current round
  try{
   const savedVote=sessionStorage.getItem(`nastrunakh.vote.${room}.${guestId}.${rs.round}`);
   if(savedVote&&(!myVote||myVote.round!==rs.round)){
    setMyVote({round:rs.round,songId:savedVote});
   }
  }catch{}

  // Restore answer for current quiz round
  if(rs.quiz){
   try{
    const savedAns=sessionStorage.getItem(`nastrunakh.ans.${room}.${guestId}.${rs.quiz.round}`);
    if(savedAns!==null&&(!myAnswer||myAnswer.round!==rs.quiz.round)){
     setMyAnswer({round:rs.quiz.round,optionIndex:Number(savedAns)});
    }
   }catch{}
  }
 },[rs,room]);

 // 20s Countdown Timer calculation
 useEffect(()=>{
  if(!rs?.quiz||rs.phase!=='quiz'){
   setTimeLeft(null);
   return;
  }
  const endsAt=rs.quiz.endsAt;
  const updateTimer=()=>{
   const diff=Math.max(0,Math.ceil((endsAt-Date.now())/1000));
   setTimeLeft(diff);
  };
  updateTimer();
  const t=setInterval(updateTimer,200);
  return()=>clearInterval(t);
 },[rs?.quiz,rs?.phase]);

 const saveName=()=>{
  const n=nameInput.trim();
  if(!n||n.length>60)return;
  localStorage.setItem('nastrunakh.guest_name',n);
  setGuestName(n);
 };

 const sendCmd=async(cmd:GuestCommand)=>{
  if(!guestName.trim())return false;
  const ok=await cmdSenderRef.current?.send(cmd);
  if(!ok)setSuggestNotice('Нет подтверждения ведущего. Проверьте связь и повторите.');
  return Boolean(ok);
 };

 const submitVote=async(songId:string)=>{
  if(!guestName.trim()||!rs||rs.phase!=='voting'||rs.votingClosed)return;
  setMyVote({round:rs.round,songId});
  try{sessionStorage.setItem(`nastrunakh.vote.${room}.${guestId}.${rs.round}`,songId);}catch{}
  const sent=await sendCmd({
   v:1,
   eventId:genEventId(),
   participantId:guestId,
   participantName:guestName,
   type:'vote',
   round:rs.round,
   songId,
   ts:Date.now(),
  });
  if(!sent){setMyVote(null);try{sessionStorage.removeItem(`nastrunakh.vote.${room}.${guestId}.${rs.round}`);}catch{}}
 };

 const submitQuizAnswer=async(optionIndex:number)=>{
  if(!guestName.trim()||!rs?.quiz||rs.phase!=='quiz'||Date.now()>=rs.quiz.endsAt||myAnswer?.round===rs.quiz.round)return;
  setMyAnswer({round:rs.quiz.round,optionIndex});
  try{sessionStorage.setItem(`nastrunakh.ans.${room}.${guestId}.${rs.quiz.round}`,String(optionIndex));}catch{}
  const sent=await sendCmd({
   v:1,
   eventId:genEventId(),
   participantId:guestId,
   participantName:guestName,
   type:'quiz_answer',
   round:rs.quiz.round,
   optionIndex,
   ts:Date.now(),
  });
  if(!sent){setMyAnswer(null);try{sessionStorage.removeItem(`nastrunakh.ans.${room}.${guestId}.${rs.quiz.round}`);}catch{}}
 };

 const submitCustomSuggest=async()=>{
  if(!guestName.trim()||!customArtist.trim()||!customTitle.trim()||!customUrl.trim())return;
  const sent=await sendCmd({
   v:1,
   eventId:genEventId(),
   participantId:guestId,
   participantName:guestName,
   type:'suggest',
   ts:Date.now(),
   custom:{
    artist:customArtist.trim(),
    title:customTitle.trim(),
    url:customUrl.trim(),
    category:customCat,
   },
  });
  if(!sent)return;
  setSuggestNotice('Песня предложена ведущему!');
  setCustomArtist('');
  setCustomTitle('');
  setCustomUrl('');
  setTimeout(()=>{setSuggestModal(false);setSuggestNotice('');},1800);
 };

 const song=rs?rs.active??(rs.mode==='play'?rs.next:null):null;
 const label=rs?.active?'СЕЙЧАС ИГРАЕМ':song?'СЛЕДУЮЩАЯ':'ИДЁТ ОТБОР ПЕСЕН';

 return <div className="v-page">
  <header className="v-top">
   <div className="v-top-left">
    <span className="v-brand">на струнах<i>.</i></span>
    <span className="v-room">{room}</span>
   </div>
   <div className="v-top-right">
    {guestName&&<span className="v-guest-pill">👤 {guestName}</span>}
    <span className={'v-status '+status} title={stText[status]}><i/>{stText[status]}</span>
   </div>
  </header>

  <main className="v-main">
   {/* Name prompt if guestName is empty */}
   {!guestName&&<div className="v-name-prompt">
    <h2>Добро пожаловать на гитарный вечер!</h2>
    <p>Введите ваше имя, чтобы участвовать в квизе и голосованиях:</p>
    <form className="v-name-form" onSubmit={e=>{e.preventDefault();saveName();}}>
     <input value={nameInput} onChange={e=>setNameInput(e.target.value)} placeholder="Ваше имя" maxLength={60} required autoFocus/>
     <button className="button primary" type="submit">Сохранить</button>
    </form>
   </div>}

   {!rs?<div className="v-empty"><h1>Ждём начала вечера…</h1><p>Код комнаты: {room}</p></div>:<>

    {/* 1. QUIZ PHASE */}
    {rs.phase==='quiz'&&rs.quiz?<section className="v-quiz-card" aria-label="Музыкальный квиз">
     <div className="v-quiz-head">
      <span className="v-quiz-tag">⚡ МУЗЫКАЛЬНЫЙ КВИЗ · РАУНД {rs.quiz.round}</span>
      <span className="v-quiz-timer">⏱ {timeLeft!==null?timeLeft+' с':'20 с'}</span>
     </div>
     <h1 className="v-quiz-question">Какую песню сейчас сыграет ведущий?</h1>
     <p className="v-quiz-sub">Выберите один из 3 вариантов:</p>
     <div className="v-quiz-options">
      {rs.quiz.options.map(opt=>{
       const isSelected=Boolean(myAnswer&&myAnswer.round===rs.quiz?.round&&myAnswer.optionIndex===opt.index);
       const isLocked=Boolean(myAnswer&&myAnswer.round===rs.quiz?.round);
       return <button
        key={opt.index}
        className={'v-quiz-opt '+(isSelected?'selected':'')+(isLocked?' locked':'')}
        disabled={isLocked||!guestName||timeLeft===0}
        onClick={()=>submitQuizAnswer(opt.index)}
       >
        <span className="v-opt-num">0{opt.index+1}</span>
        <div className="v-opt-text">
         <strong>{opt.title}</strong>
         <small>{opt.artist}</small>
        </div>
       </button>;
      })}
     </div>
     {myAnswer?.round===rs.quiz.round&&<p className="v-quiz-status">✓ Ответ отправлен. Ждём результата ведущего…</p>}
    </section>:null}

    {/* 2. REVEALED PHASE */}
    {rs.phase==='revealed'&&rs.revealed?<section className="v-card now v-reveal-card" aria-label="Результат квиза">
     <span className="v-label">🎉 ПРАВИЛЬНЫЙ ОТВЕТ · СЕЙЧАС ИГРАЕМ <span className="v-eq" aria-hidden="true"><i/><i/><i/></span></span>
     <div className="v-song">
      <span className="v-artist">{rs.revealed.correctSong.artist}</span>
      <h1 className="v-title">{rs.revealed.correctSong.title}</h1>
      <a className="v-link" href={rs.revealed.correctSong.url} target="_blank" rel="noopener noreferrer">Текст и аккорды ↗</a>
     </div>
     {rs.revealed.votingResults.length>0&&<div className="v-vote-results">
      <h3>Итоги голосования зрителей:</h3>
      <div className="v-vote-bars">
       {rs.revealed.votingResults.map(vr=><div key={vr.songId} className="v-vote-row">
        <span>{vr.title} ({vr.artist})</span>
        <b>{vr.votes} {vr.votes===1?'голос':vr.votes<5?'голоса':'голосов'}</b>
       </div>)}
      </div>
     </div>}
    </section>:null}

    {/* 3. VOTING PHASE */}
    {rs.phase==='voting'&&rs.votingOptions?<section className="v-voting-card" aria-label="Голосование">
     <div className="v-quiz-head">
      <span className="v-quiz-tag">🗳 {rs.votingClosed?'ГОЛОСОВАНИЕ ЗАВЕРШЕНО':'ГОЛОСОВАНИЕ ЗА СЛЕДУЮЩУЮ ПЕСНЮ'}</span>
     </div>
     <h1 className="v-quiz-question">{rs.votingClosed?'Голосование закрыто':'Что сыграем следующим?'}</h1>
     <p className="v-quiz-sub">{rs.votingClosed?'Ведущий готовит песню к квизу…':'Отдайте голос за любимый трек:'}</p>
     <div className="v-voting-list">
      {rs.votingOptions.map(opt=>{
       const selected=myVote?.round===rs.round&&myVote.songId===opt.songId;
       return <button
        key={opt.songId}
        className={'v-voting-item '+(selected?'selected':'')+(rs.votingClosed?' locked':'')}
        disabled={!guestName||rs.votingClosed} onClick={()=>submitVote(opt.songId)}
       >
        <div className="v-opt-text">
         <strong>{opt.title}</strong>
         <small>{opt.artist}</small>
        </div>
        <span className="v-vote-check">{selected?'✓ Ваш голос':rs.votingClosed?'Закрыто':'Голосовать'}</span>
       </button>;
      })}
     </div>
    </section>:null}

    {/* 4. IDLE / STANDARD STAGE */}
    {rs.phase==='idle'?<section className={'v-card'+(rs.active?' now':'')} aria-label="Текущая песня">
     <span className="v-label">{label}{rs.active&&<span className="v-eq" aria-hidden="true"><i/><i/><i/></span>}</span>
     {song?<div className="v-song">
      <span className="v-artist">{song.artist}</span>
      <h1 className="v-title">{song.title}</h1>
      <a className="v-link" href={song.url} target="_blank" rel="noopener noreferrer">Текст и аккорды ↗</a>
     </div>:<p className="v-pick">Ведущий выбирает песни — здесь появится первая из них.</p>}
    </section>:null}

    {suggestNotice&&<p role="status">{suggestNotice}</p>}
    {/* Suggest song floating trigger */}
    <div className="v-actions-bar">
     <button className="button primary v-suggest-btn" disabled={!guestName} onClick={()=>setSuggestModal(true)}>
      ➕ Предложить свою песню
     </button>
    </div>

    {/* Queue Panel */}
    {rs.queue.length>0&&<section className="v-queue" aria-label="Очередь">
     <h2>Дальше по списку · {rs.queue.length}</h2>
     <ol>{rs.queue.slice(0,12).map((q,i)=><li key={i}><span className="v-num">{String(i+1).padStart(2,'0')}</span><span className="v-qtext"><strong>{q.title}</strong><small>{q.artist}</small></span></li>)}</ol>
    </section>}

    {/* Leaderboard Dashboard */}
    {rs.leaderboard&&rs.leaderboard.length>0&&<section className="v-leaderboard" aria-label="Таблица лидеров">
     <h2>🏆 Топ знатоков вечера</h2>
     <div className="v-lb-table">
      {rs.leaderboard.slice(0,10).map((lb,i)=><div key={lb.participantId} className={'v-lb-row '+(lb.participantId===guestId?'me':'')}>
       <span className="v-lb-rank">{i===0?'🥇':i===1?'🥈':i===2?'🥉':String(i+1)+'.'}</span>
       <span className="v-lb-name">{lb.name} {lb.participantId===guestId&&<small>(вы)</small>}</span>
       <span className="v-lb-score">{lb.score} {lb.score===1?'балл':lb.score<5?'балла':'баллов'}</span>
      </div>)}
     </div>
    </section>}

    <footer className="v-foot">
     <span>Сыграно за вечер: {rs.played}</span>
     <span>Обновлено {new Date(rs.ts).toLocaleTimeString('ru-RU')}</span>
    </footer>
   </>}
  </main>

  {/* Suggestion Modal */}
  {suggestModal&&<div className="v-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setSuggestModal(false);}}>
   <div className="v-modal-card">
    <div className="v-modal-head">
     <h3>Предложить песню ведущему</h3>
     <button className="icon-button" onClick={()=>setSuggestModal(false)}>✕</button>
    </div>
    {rs?.catalog&&<form className="v-suggest-form" onSubmit={async e=>{e.preventDefault();if(!catalogChoice||!guestName)return;const sent=await sendCmd({v:1,eventId:genEventId(),participantId:guestId,participantName:guestName,type:'suggest',ts:Date.now(),songId:catalogChoice});if(sent)setSuggestNotice('Песня из каталога предложена ведущему');}}>
     <label>Из каталога<select value={catalogChoice} onChange={e=>setCatalogChoice(e.target.value)} required><option value="">Выберите песню</option>{rs.catalog.map(s=><option key={s.songId} value={s.songId}>{s.artist} — {s.title}</option>)}</select></label>
     <button className="button primary" type="submit">Предложить из каталога</button>
    </form>}
    <form className="v-suggest-form" onSubmit={e=>{e.preventDefault();submitCustomSuggest();}}>
     <label>
      Исполнитель
      <input value={customArtist} onChange={e=>setCustomArtist(e.target.value)} required placeholder="Например, Би-2"/>
     </label>
     <label>
      Название песни
      <input value={customTitle} onChange={e=>setCustomTitle(e.target.value)} required placeholder="Полковнику никто не пишет"/>
     </label>
     <label>
      Ссылка на аккорды / текст
      <input type="url" value={customUrl} onChange={e=>setCustomUrl(e.target.value)} required placeholder="https://..."/>
     </label>
     {suggestNotice&&<p className="v-modal-notice">{suggestNotice}</p>}
     <div className="v-modal-actions">
      <button className="button primary" type="submit">Отправить ведущему</button>
     </div>
    </form>
   </div>
  </div>}
 </div>;
}
