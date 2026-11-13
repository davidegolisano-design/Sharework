import {tr} from './locale.js?v=454db9f1047d';
import {SUPABASE_URL as URL,SUPABASE_KEY as KEY} from './config.js?v=454db9f1047d';
const SESSION='sharework.session';let session;try{session=JSON.parse(localStorage.getItem(SESSION)||'null');}catch{session=null;}
let refreshing;
export function getSession(){return session;}
export function setSession(s){session=s;if(s)localStorage.setItem(SESSION,JSON.stringify(s));else localStorage.removeItem(SESSION);}
async function renew(){if(!session?.refresh_token)throw Error(tr('Accedi nuovamente.'));if(!refreshing)refreshing=(async()=>{const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});const data=await r.json();if(!r.ok){setSession(null);throw Error(tr('Sessione scaduta. Accedi nuovamente.'));}setSession({...data,expires_at:Date.now()/1000+data.expires_in});})().finally(()=>refreshing=null);return refreshing;}
export async function request(path,{method='GET',body,raw=false,anonymous=false,headers={}}={}){
 if(!anonymous&&session&&session.expires_at<Date.now()/1000+60)await renew();
 const h={apikey:KEY,...headers};if(session&&!anonymous)h.Authorization='Bearer '+session.access_token;
 if(body!==undefined&&!(body instanceof Blob)){h['Content-Type']='application/json';body=JSON.stringify(body);}
 const r=await fetch(URL+path,{method,headers:h,body});if(!r.ok){let e;try{e=await r.json();}catch{}throw Error(e?.msg||e?.message||e?.error_description||e?.error||tr('Operazione non riuscita')+' ('+r.status+').');}
 if(raw)return r.blob();if(r.status===204)return null;const text=await r.text();return text?JSON.parse(text):null;
}
export async function signIn(email,password){const d=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},anonymous:true});setSession({...d,expires_at:Date.now()/1000+d.expires_in});}
export async function signUp(email,password,full_name){const d=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:{email,password,data:{full_name}},anonymous:true});if(d.access_token)setSession({...d,expires_at:Date.now()/1000+d.expires_in});return d;}
export async function signOut(){try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{setSession(null);}}
export function authCallback(){const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('access_token')){setSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_at:Date.now()/1000+Number(hash.get('expires_in')||3600)});history.replaceState(null,'',location.pathname);return hash.get('type');}if(hash.has('error_description')){const message=hash.get('error_description');history.replaceState(null,'',location.pathname);throw Error(message);}return null;}
export const table=(name,query='',options={})=>request('/rest/v1/'+name+(query?'?'+query:''),{...options,headers:{Prefer:'return=representation',...options.headers}});
export const rpc=(name,body)=>request('/rest/v1/rpc/'+name,{method:'POST',body});
export const pdfUpload=(path,file)=>request('/storage/v1/object/sharework-pdfs/'+path,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','x-upsert':'false'}});
export const pdfDownload=path=>request('/storage/v1/object/authenticated/sharework-pdfs/'+path,{raw:true});
export const pdfCleanup=path=>request('/storage/v1/object/sharework-pdfs',{method:'DELETE',body:{prefixes:[path]}});
