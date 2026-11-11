// Браузерный слой локального API: перехватывает fetch('/api/library')
// и обслуживает его из localStorage через api-core. UI (app/page.tsx) не меняется.
import seedCsv from '../lib/catalog.csv?raw';
import {createLibraryApi} from './api-core';

export function installLocalApi(){
 const handle=createLibraryApi(seedCsv,window.localStorage);
 const original=window.fetch.bind(window);
 window.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const rawUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  let url:URL;try{url=new URL(rawUrl,window.location.href);}catch{return original(input as RequestInfo,init);}
  if(!url.pathname.endsWith('/api/library'))return original(input as RequestInfo,init);
  const request=input instanceof Request?input:null;
  const method=(init?.method??request?.method??'GET').toUpperCase();
  let bodyText:string|null=null;
  try{
   if(init?.body!=null)bodyText=typeof init.body==='string'?init.body:init.body instanceof URLSearchParams?init.body.toString():await new Response(init.body).text();
   else if(request&&method!=='GET'&&method!=='HEAD')bodyText=await request.clone().text();
  }catch{bodyText=null;}
  const result=await handle(url,method,bodyText);
  const headers=new Headers({'Cache-Control':'no-store'});
  if(result.csv!==undefined){
   headers.set('Content-Type','text/csv; charset=utf-8');
   headers.set('Content-Disposition','attachment; filename="guitar-library.csv"');
   return new Response(result.csv,{status:result.status,headers});
  }
  headers.set('Content-Type','application/json');
  return new Response(JSON.stringify(result.json),{status:result.status,headers});
 };
}
