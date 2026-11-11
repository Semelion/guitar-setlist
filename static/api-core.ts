// Ядро локального API для статической версии (GitHub Pages).
// Повторяет семантику серверного /api/library (app/api/library/route.ts),
// но хранит данные в переданном key-value хранилище (в браузере — localStorage).
// Чистая функция без зависимостей от браузера — покрыта тестами tests/static-api.test.mjs.
import {csvDecode,csvEncode,emptySession,validateSession,validateSong,type Session,type Song} from '../lib/core.ts';

export interface Kv{getItem(k:string):string|null;setItem(k:string,v:string):void}
export type ApiResult={status:number;json?:unknown;csv?:string};
export const keys={catalog:'nastrunakh.catalog.csv',session:'nastrunakh.session.json',versions:'nastrunakh.versions.json'};
type Versions={catalog:string;session:string;n:number};

export function createLibraryApi(seedCsv:string,kv:Kv){
 const readVersions=():Versions=>{try{const v=JSON.parse(kv.getItem(keys.versions)||'') as Versions;if(v&&typeof v.n==='number')return v;}catch{}return{catalog:'seed',session:'seed',n:0};};
 const writeVersions=(v:Versions)=>kv.setItem(keys.versions,JSON.stringify(v));
 const loadCatalog=()=>{const raw=kv.getItem(keys.catalog);const v=readVersions();return{songs:csvDecode(raw??seedCsv),version:raw===null?'seed':v.catalog};};
 const loadSession=(ids:Set<string>)=>{const raw=kv.getItem(keys.session);const v=readVersions();return{session:raw?validateSession(JSON.parse(raw),ids):emptySession,version:raw===null?'seed':v.session};};
 const json=(x:unknown,status=200):ApiResult=>({status,json:x});

 return async function handle(url:URL,method:string,bodyText?:string|null):Promise<ApiResult>{
  try{
   if(method==='GET'){
    const cat=loadCatalog();
    if(url.searchParams.has('download'))return{status:200,csv:'\uFEFF'+csvEncode(cat.songs)};
    const ses=loadSession(new Set(cat.songs.map(s=>s.id)));
    return json({songs:cat.songs,catalogVersion:cat.version,session:ses.session,sessionVersion:ses.version});
   }
   if((bodyText??'').length>200000)return json({error:'Слишком большой запрос'},413);
   let body:{version?:unknown;song?:unknown;session?:unknown};
   try{body=JSON.parse(bodyText||'{}');}catch{return json({error:'Неверный формат запроса'},400);}
   if(typeof body.version!=='string')return json({error:'Не указана версия данных'},400);
   const cat=loadCatalog();
   const ids=new Set(cat.songs.map(s=>s.id));
   if(method==='POST'){
    if(body.version!==cat.version)return json({error:'Каталог изменился в другой вкладке. Данные обновлены — повторите добавление.'},409);
    let song:Song;try{song=validateSong(body.song);}catch(e){return json({error:e instanceof Error?e.message:'Неверные данные песни'},400);}
    if(cat.songs.some(s=>s.artist.toLowerCase()===song.artist.toLowerCase()&&s.title.toLowerCase()===song.title.toLowerCase()))return json({error:'Такая песня уже есть в каталоге.'},400);
    cat.songs.push(song);
    const v=readVersions();const nv:Versions={catalog:'local-'+(v.n+1),session:v.session,n:v.n+1};
    kv.setItem(keys.catalog,csvEncode(cat.songs));writeVersions(nv);
    return json({version:nv.catalog,songs:cat.songs});
   }
   if(method==='PUT'){
    const ses=loadSession(ids);
    if(body.version!==ses.version)return json({error:'Очередь изменилась в другой вкладке. Данные обновлены — повторите действие.'},409);
    let session:Session;try{session=validateSession(body.session,ids);}catch(e){return json({error:e instanceof Error?e.message:'Неверная очередь'},400);}
    const v=readVersions();const nv:Versions={catalog:v.catalog,session:'local-'+(v.n+1),n:v.n+1};
    kv.setItem(keys.session,JSON.stringify(session));writeVersions(nv);
    return json({version:nv.session});
   }
   return json({error:'Метод не поддерживается'},405);
  }catch(e){return json({error:e instanceof Error?e.message:'Не удалось обработать запрос.'},500);}
 };
}
