import { useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Gem, LoaderCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { useForm, type FieldValues, type DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { ApiError } from './api';
export function Button({children,variant='primary',className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'danger'|'ghost'}){return <button {...props} className={'btn '+variant+' '+className}>{children}</button>;}
export function Modal({open,onClose,title,description,children,drawer=false,className=''}:{open:boolean;onClose:()=>void;title:string;description?:string;children:ReactNode;drawer?:boolean;className?:string}){
  const restore=useRef<HTMLElement|null>(null);
  return <Dialog.Root open={open} onOpenChange={v=>{if(!v)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={'modal '+(drawer?'drawer':'')+' '+className} onOpenAutoFocus={()=>{restore.current=document.activeElement as HTMLElement;}} onCloseAutoFocus={e=>{if(restore.current?.isConnected){e.preventDefault();restore.current.focus();}}}><div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description className={description?'muted':'sr-only'}>{description??title}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" aria-label="Close dialog"><X size={20}/></Button></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Photo({product,large=false,onClick}:{product:{name:string;photo:{url:string;thumbnailUrl?:string}|null};large?:boolean;onClick?:()=>void}){
  const content=product.photo?<img src={large?product.photo.url:product.photo.thumbnailUrl??product.photo.url} alt={product.name} loading="lazy"/>:<Gem size={large?64:23} strokeWidth={1.2}/>;
  return onClick?<button className={'product-photo '+(large?'large':'')} onClick={onClick} aria-label={'Enlarge photo of '+product.name}>{content}</button>:<div className={'product-photo '+(large?'large':'')}>{content}</div>;
}
export function Empty({title,children,action}:{title:string;children?:ReactNode;action?:ReactNode}){return <div className="empty"><span className="empty-icon"><Gem size={36} strokeWidth={1}/></span><h2>{title}</h2><p>{children}</p>{action}</div>;}
export function Loading(){return <div role="status" className="loading"><LoaderCircle className="spin" size={22}/> Loading showroom…</div>;}
export function ErrorBox({error}:{error:unknown}){return error?<div role="alert" className="error">{error instanceof Error?error.message:'Something went wrong. Please try again.'}</div>:null;}
export function Pager({page,count,pageSize=20,onChange}:{page:number;count:number;pageSize?:number;onChange:(page:number)=>void}){return <div className="pager"><span>{count} records · Page {page} of {Math.max(1,Math.ceil(count/pageSize))}</span><div><Button variant="secondary" disabled={page===1} aria-label="Previous page" onClick={()=>onChange(page-1)}><ArrowLeft size={16}/><span>Previous</span></Button><Button variant="secondary" disabled={page*pageSize>=count} aria-label="Next page" onClick={()=>onChange(page+1)}><ArrowRight size={16}/><span>Next</span></Button></div></div>;}
export type Field={name:string;label:string;type?:string;options?:{value:string;label:string}[];hint?:string};
export function DataForm({schema,defaults,fields,onSubmit,submitLabel='Save changes',children}:{schema:z.ZodTypeAny;defaults:FieldValues;fields:Field[];onSubmit:(values:FieldValues)=>Promise<void>;submitLabel?:string;children?:ReactNode}){
  const {register,handleSubmit,formState:{errors,isSubmitting},setError}=useForm({resolver:zodResolver(schema),defaultValues:defaults as DefaultValues<FieldValues>});
  return <form onSubmit={handleSubmit(async values=>{try{await onSubmit(values);}catch(error){if(error instanceof ApiError&&error.fields)for(const [name,messages]of Object.entries(error.fields.fieldErrors))setError(name,{message:messages?.[0]});setError('root',{message:error instanceof Error?error.message:'Could not save changes.'});}})} className="form-stack">
    {fields.map(field=><div className="field" key={field.name}><label htmlFor={'field-'+field.name}>{field.label}</label>{field.options?<select id={'field-'+field.name} {...register(field.name)}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==='textarea'?<textarea id={'field-'+field.name} {...register(field.name)}/>:<input id={'field-'+field.name} type={field.type??'text'} step={field.type==='number'?'1':undefined} autoComplete={field.type==='password'?(field.name==='password'?'current-password':'new-password'):field.type==='email'?'username':undefined} {...register(field.name,{valueAsNumber:field.type==='number'})} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name]?'error-'+field.name:undefined}/>}
      {field.hint&&<small>{field.hint}</small>}{errors[field.name]&&<p className="field-error" id={'error-'+field.name}>{String(errors[field.name]?.message)}</p>}</div>)}
    {children}{errors.root&&<div role="alert" className="error">{String(errors.root.message)}</div>}<Button type="submit" disabled={isSubmitting}>{isSubmitting?<><LoaderCircle size={16} className="spin"/> Saving…</>:submitLabel}</Button>
  </form>;
}
