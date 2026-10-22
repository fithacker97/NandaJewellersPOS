import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrf } from './api';
import { Loading, ErrorBox } from './ui';
import type { User } from './types';
type AuthValue={user:User|null;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>};
const AuthContext=createContext<AuthValue>(null!);
export const useAuth=()=>useContext(AuthContext);
export function AuthProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState<unknown>(null);const cache=useQueryClient();const initialized=useRef(false);
  useEffect(()=>{if(initialized.current)return;initialized.current=true;api<{user:User;csrfToken:string}>('/auth/me').then(async data=>{setCsrf(data.csrfToken);if(!window.location.pathname.startsWith('/labels/'))await api('/invoice-drafts/current','DELETE');setUser(data.user);}).catch(error=>{if(!(error instanceof ApiError&&error.status===401))setError(error);}).finally(()=>setLoaded(true));},[]);
  useEffect(()=>{const expired=()=>{setUser(null);setCsrf('');cache.clear();};window.addEventListener('nanda-session-expired',expired);return()=>window.removeEventListener('nanda-session-expired',expired);},[cache]);
  async function login(email:string,password:string){const data=await api<{user:User;csrfToken:string}>('/auth/login','POST',{email,password});setCsrf(data.csrfToken);await api('/invoice-drafts/current','DELETE');cache.clear();setUser(data.user);}
  async function logout(){await api('/auth/logout','POST');setUser(null);setCsrf('');cache.clear();}
  if(!loaded)return <Loading/>;
  if(error)return <main className="login-page"><ErrorBox error={error}/><button className="btn secondary" onClick={()=>location.reload()}>Retry connection</button></main>;
  return <AuthContext.Provider value={{user,login,logout}}>{children}</AuthContext.Provider>;
}
const ToastContext=createContext<(message:string)=>void>(()=>{});
export const useToast=()=>useContext(ToastContext);
export function ToastProvider({children}:{children:ReactNode}){const [message,setMessage]=useState('');useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),3500);return()=>clearTimeout(timer);},[message]);return <ToastContext.Provider value={setMessage}>{children}<div role="status" aria-live="polite" className={message?'toast':'sr-only'}>{message}</div></ToastContext.Provider>;}
