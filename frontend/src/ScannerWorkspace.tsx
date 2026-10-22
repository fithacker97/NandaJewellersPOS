import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, ScanLine, Trash2 } from 'lucide-react';
import { inr, normalizeBarcode } from '@nanda/shared';
import { api, ApiError } from './api';
import { useToast } from './context';
import { PhoneScanner, useScannerConnections } from './PhoneScanner';
import { Button, ErrorBox, Loading, Modal, Photo } from './ui';
import type { Draft, Invoice, Product } from './types';

export function ScannerWorkspace(){
  const cache=useQueryClient(),toast=useToast(),links=useScannerConnections();
  const [open,setOpen]=useState(false),[barcode,setBarcode]=useState(''),[gunReady,setGunReady]=useState(false);
  const [pending,setPending]=useState(false),[error,setError]=useState<unknown>(null),[reviewed,setReviewed]=useState<Draft|null>(null),[invoice,setInvoice]=useState<Invoice|null>(null);
  const [customer,setCustomer]=useState({customerName:'',customerPhone:''});
  const seen=useRef(new Map<string,string>()),initialized=useRef(false),scanBusy=useRef(false);
  const issuance=useRef({draftId:'',key:''});
  const q=useQuery({queryKey:['draft'],queryFn:()=>api<Draft>('/invoice-drafts/current'),enabled:open&&!invoice,refetchInterval:open&&!invoice?1000:false});
  const selected=q.data?.lines.find(line=>line.barcode===barcode);
  const product=useQuery({queryKey:['product',selected?.productId],queryFn:()=>api<Product>('/products/'+selected!.productId),enabled:open&&!!selected&&!invoice});
  useEffect(()=>{
    if(!q.data)return;
    setCustomer({customerName:q.data.customerName,customerPhone:q.data.customerPhone});
    if(issuance.current.draftId!==q.data.id)issuance.current={draftId:q.data.id,key:crypto.randomUUID()};
  },[q.data?.id]);
  useEffect(()=>{
    if(reviewed&&q.data&&q.data.quoteToken!==reviewed.quoteToken){setReviewed(null);setError(new Error('This bill changed. Check the latest items and total again.'));}
  },[q.data,reviewed]);
  useEffect(()=>{
    if(!links.data)return;
    const baseline=!initialized.current;initialized.current=true;
    for(const link of links.data.items){
      const event=link.events?.[0];
      if(event&&seen.current.get(link.id)!==event.id){
        seen.current.set(link.id,event.id);
        if(!baseline&&link.pairedAt){setBarcode(event.barcode);setInvoice(null);setReviewed(null);setError(null);setOpen(true);void cache.invalidateQueries({queryKey:['draft']});}
      }
    }
  },[links.data,cache]);
  async function scan(value:string){
    if(scanBusy.current||!value.trim())return;
    scanBusy.current=true;setError(null);
    try{
      const next=await api<Draft>('/invoice-drafts/current/scan','POST',{barcode:value});
      cache.setQueryData(['draft'],next);setBarcode(normalizeBarcode(value));setReviewed(null);setInvoice(null);setOpen(true);
    }catch(reason){toast(reason instanceof Error?reason.message:'Product could not be scanned');}
    finally{scanBusy.current=false;}
  }
  useEffect(()=>{
    if(!gunReady)return;
    let buffer='',last=0;
    const receive=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement|null;
      if(target?.isContentEditable||target?.closest('input,textarea,select')||event.ctrlKey||event.metaKey||event.altKey)return;
      if(event.key==='Enter'){
        if(buffer.length>=3&&Date.now()-last<250){event.preventDefault();void scan(buffer);}
        buffer='';return;
      }
      if(event.key.length===1){const now=Date.now();buffer=(now-last>120?'':buffer)+event.key;last=now;}
    };
    document.addEventListener('keydown',receive);
    return()=>document.removeEventListener('keydown',receive);
  },[gunReady]);
  async function change(path:string,method:string,body?:unknown){
    setPending(true);setReviewed(null);setError(null);
    try{cache.setQueryData(['draft'],await api<Draft>(path,method,body));}
    catch(reason){setError(reason);}finally{setPending(false);}
  }
  async function closeBill(){
    if(pending)return;
    if(invoice){setOpen(false);return;}
    setPending(true);setError(null);
    try{
      const next=await api<Draft>('/invoice-drafts/current','DELETE');
      cache.setQueryData(['draft'],next);setBarcode('');setCustomer({customerName:'',customerPhone:''});setReviewed(null);setOpen(false);
    }catch(reason){setError(reason);}finally{setPending(false);}
  }
  async function review(){
    setPending(true);setError(null);
    try{
      const next=await api<Draft>('/invoice-drafts/current/customer','PATCH',{...customer,note:q.data?.note??''});
      cache.setQueryData(['draft'],next);setReviewed(next);
    }catch(reason){setError(reason);}finally{setPending(false);}
  }
  async function issue(){
    if(!reviewed||pending)return;
    setPending(true);setError(null);
    try{
      const saved=await api<Invoice>('/invoice-drafts/current/issue','POST',{draftId:reviewed.id,quoteToken:reviewed.quoteToken,issuanceKey:issuance.current.key});
      setInvoice(saved);setReviewed(null);await cache.invalidateQueries();
    }catch(reason){
      if(reason instanceof ApiError&&reason.details?.quote)cache.setQueryData(['draft'],reason.details.quote);
      setReviewed(null);setError(reason);
    }finally{setPending(false);}
  }
  const invalid=!q.data?.lines.length||q.data.lines.some(line=>!line.active||!line.configured||line.quantity>line.available);
  return <>
    <PhoneScanner minimal onGunReady={()=>{setGunReady(true);toast('Scan gun ready. Scan a product barcode to open its bill.');}}/>
    {open&&<Modal open drawer onClose={()=>void closeBill()} title={invoice?'Bill saved':selected?.productName??'Product & bill'} description={invoice?invoice.number:'Scanned product details and your current bill.'}>
      <div className="scan-billing-drawer">
        {invoice?<div className="scanner-bill-saved"><CheckCircle2 size={40}/><h2>{invoice.number}</h2><strong>{inr(invoice.total)}</strong><p>The bill is saved and stock is updated.</p><Link className="btn primary" to={'/invoices/'+invoice.id} onClick={()=>setOpen(false)}>View / print bill</Link><p className="small muted">Your phone stays paired. Scan the next product to start a new bill.</p></div>:<>
          {q.isPending?<Loading/>:<>
            <ErrorBox error={q.error}/>
            {selected&&<section className="scanned-product-details">
              {product.data&&<Photo product={product.data}/>}
              <div><span className={'badge '+selected.metal.toLowerCase()}>{selected.metal}</span><p className="barcode-cell">{selected.barcode}</p><strong>{inr(selected.piecePrice)} / piece</strong></div>
              <dl><div><dt>Net weight</dt><dd>{selected.weight} g</dd></div><div><dt>Rate / g</dt><dd>{inr(selected.sellingRate)}</dd></div><div><dt>Available</dt><dd>{selected.available} pieces</dd></div></dl>
            </section>}
            {product.error&&<ErrorBox error={product.error}/>}
            <section className="scanner-bill-items"><h3>Items in this bill</h3>{q.data?.lines.map(line=><div key={line.id} className={'scanner-bill-item '+(line.barcode===barcode?'selected':'')}>
              <div><strong>{line.productName}</strong><small>{line.weight} g · {inr(line.piecePrice)} / piece</small>{(!line.active||!line.configured||line.quantity>line.available)&&<small className="field-error">{!line.active?'Archived product':!line.configured?'Set the metal rate before saving':'Insufficient stock'}</small>}</div>
              <div className="scanner-item-controls"><Button variant="ghost" aria-label={'Decrease '+line.productName+' quantity'} disabled={pending||line.quantity<=1} onClick={()=>void change('/invoice-drafts/current/lines/'+line.id,'PATCH',{quantity:line.quantity-1})}><Minus size={15}/></Button><span>{line.quantity}</span><Button variant="ghost" aria-label={'Increase '+line.productName+' quantity'} disabled={pending||line.quantity>=line.available} onClick={()=>void change('/invoice-drafts/current/lines/'+line.id,'PATCH',{quantity:line.quantity+1})}><Plus size={15}/></Button><strong>{inr(line.lineTotal)}</strong><Button variant="ghost" aria-label={'Remove '+line.productName} disabled={pending} onClick={()=>void change('/invoice-drafts/current/lines/'+line.id,'DELETE')}><Trash2 size={16}/></Button></div>
            </div>)}</section>
            <div className="scanner-customer-fields"><div className="field"><label htmlFor="scan-customer-name">Customer (optional)</label><input id="scan-customer-name" value={customer.customerName} placeholder="Walk-in customer" maxLength={120} disabled={pending} onChange={event=>{setCustomer({...customer,customerName:event.target.value});setReviewed(null);}}/></div><div className="field"><label htmlFor="scan-customer-phone">Phone (optional)</label><input id="scan-customer-phone" type="tel" value={customer.customerPhone} maxLength={30} disabled={pending} onChange={event=>{setCustomer({...customer,customerPhone:event.target.value});setReviewed(null);}}/></div></div>
            <div className="scanner-bill-total"><span>{q.data?.totalPieces??0} pieces · {q.data?.totalWeight??'0'} g<strong>Total</strong></span><strong>{inr(q.data?.total??'0')}</strong></div>
            {reviewed&&<div className="notice">Check the items and total above. Saving this bill reduces stock.</div>}
            <ErrorBox error={error}/><Button className="w-full" disabled={pending||invalid} onClick={()=>void(reviewed?issue():review())}>{pending?'Please wait…':reviewed?'Save bill':'Check & save bill'}</Button>
            <p className="footnote">Keep scanning to add products. Closing this bill discards unsaved items. Stock changes only when you save the bill.</p>
          </>}
        </>}
      </div>
    </Modal>}
  </>;
}
