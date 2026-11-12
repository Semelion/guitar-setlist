import type {Session,Song} from '../lib/core.ts';
import type {Suggestion} from './host-state.ts';
type Data={session:Session;sessionVersion:string;catalogVersion:string;songs:Song[];error?:string;version?:string};
export async function libraryRequest(fetcher:typeof fetch,method='GET',body?:unknown):Promise<Data>{
 const response=await fetcher('/api/library',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json() as Data;
 if(!response.ok)throw Error(data.error||'Не удалось сохранить библиотеку');
 return data;
}
export async function selectHostSong(fetcher:typeof fetch,id:string,playing=false){
 const d=await libraryRequest(fetcher);
 if(!d.songs.some(x=>x.id===id))throw Error('Песня не найдена');
 const session={...d.session,queue:[id,...d.session.queue.filter(x=>x!==id)],played:d.session.played.filter(x=>x!==id),skipped:d.session.skipped.filter(x=>x!==id),active:playing?id:null};
 await libraryRequest(fetcher,'PUT',{version:d.sessionVersion,session});
 return session;
}
export async function acceptHostSuggestion(fetcher:typeof fetch,s:Suggestion){
 let d=await libraryRequest(fetcher),id=s.songId;
 if(s.custom){
  // A repeated accept after a failed queue write reuses the saved catalog entry.
  const existing=d.songs.find(x=>x.artist===s.custom!.artist&&x.title===s.custom!.title&&x.url===s.custom!.url);
  if(existing)id=existing.id;
  else{
   const added=await libraryRequest(fetcher,'POST',{version:d.catalogVersion,song:s.custom});
   id=added.songs.find(x=>x.artist===s.custom!.artist&&x.title===s.custom!.title&&x.url===s.custom!.url)?.id;
   if(!id)throw Error('Новая песня не найдена в каталоге');
   d=await libraryRequest(fetcher);
  }
 }
 if(!id||!d.songs.some(x=>x.id===id))throw Error('Песня не найдена');
 if(d.session.queue.includes(id))return;
 await libraryRequest(fetcher,'PUT',{version:d.sessionVersion,session:{...d.session,queue:[...d.session.queue,id],played:d.session.played.filter(x=>x!==id),skipped:d.session.skipped.filter(x=>x!==id)}});
}
