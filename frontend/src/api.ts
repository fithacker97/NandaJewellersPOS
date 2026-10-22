import type { Draft } from './types';
let csrf='';
export function setCsrf(value:string){csrf=value;}
export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public details?:{quote?:Draft},public fields?:{fieldErrors:Record<string,string[]>}){super(message);}}
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch('/api'+path,{method,credentials:'include',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const data=await response.json();
  if(response.status===401 && path!=='/auth/login' && path!=='/auth/me') window.dispatchEvent(new Event('nanda-session-expired'));
  if(!response.ok)throw new ApiError(response.status,data.error?.code??'REQUEST_FAILED',data.error?.message??'Could not complete the request.',data.error?.details,data.error?.fields);
  return data;
}
export function uploadPhoto(file:File,onProgress:(percent:number)=>void):Promise<{id:string;url:string}>{
  return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/uploads/photos');xhr.withCredentials=true;xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};xhr.onerror=()=>reject(new Error('Upload failed. Check your connection and retry.'));xhr.onload=()=>{try{const data=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new ApiError(xhr.status,data.error?.code,data.error?.message??'Upload failed.'));}catch{reject(new Error('Upload failed. Try again.'));}};const body=new FormData();body.append('photo',file);xhr.send(body);});
}
export async function download(path:string,name:string){
  const response=await fetch('/api'+path,{credentials:'include'});if(!response.ok)throw new Error('Download failed. Your session may have expired.');
  const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
