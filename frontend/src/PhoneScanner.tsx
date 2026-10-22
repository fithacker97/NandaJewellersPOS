import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Smartphone, RefreshCw, Unplug, CheckCircle2 } from 'lucide-react';
import { showroomDate } from '@nanda/shared';
import { api } from './api';
import { useToast } from './context';
import { Button, ErrorBox, Loading, Modal } from './ui';

type Connection = { id:string; pairedAt:string|null; pairingExpiresAt:string; _count:{events:number}; events?:{id:string;barcode:string;createdAt:string}[] };
type Pairing = { id:string; pairingExpiresAt:string; qrCodes:{address:string;svg:string}[]; cashierName:string };
export function useScannerConnections(){
  return useQuery({queryKey:['scanner-links'],queryFn:()=>api<{items:Connection[]}>('/scanner/connections'),refetchInterval:1000,refetchOnMount:'always'});
}
export function PhoneScanner({required=false,minimal=false,onGunReady}:{required?:boolean;minimal?:boolean;onGunReady?:()=>void}){
  const cache=useQueryClient(),toast=useToast();
  const location=useLocation(),navigate=useNavigate();
  const started=useRef(false);
  const [open,setOpen]=useState(false),[pairing,setPairing]=useState<Pairing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[address,setAddress]=useState(''),[now,setNow]=useState(Date.now());
  const links=useScannerConnections();
  const active=links.data?.items.find(link=>link.pairedAt);
  useEffect(()=>{
    if(minimal&&location.state?.openScanner&&!links.isPending){
      if(active){setOpen(true);setError(null);}else void generate();
      navigate(location.pathname+location.search,{replace:true,state:null});
    }
  },[minimal,location.state,links.isPending]);
  useEffect(()=>{if(minimal&&active?.id===pairing?.id&&active&&open){setOpen(false);setPairing(null);toast('Phone paired. Scan a product to open its details and bill.');}},[minimal,active?.id,pairing?.id,open]);
  useEffect(()=>{if(!open&&!required)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[open,required]);
  useEffect(()=>{
    if(required&&links.isFetchedAfterMount&&!links.error&&!active&&!started.current){started.current=true;void generate();}
  },[required,links.isFetchedAfterMount,links.error,active]);
  async function generate(){
    started.current=true;
    setOpen(true);setBusy(true);setError(null);setPairing(null);
    try{const next=await api<Pairing>('/scanner/connections','POST',{});setPairing(next);setAddress(next.qrCodes[0]?.address??'');await cache.invalidateQueries({queryKey:['scanner-links']});}
    catch(error){setError(error);}finally{setBusy(false);}
  }
  async function disconnect(id:string){
    setBusy(true);try{await api('/scanner/connections/'+id,'DELETE');setPairing(null);await cache.invalidateQueries({queryKey:['scanner-links']});toast('Phone scanner disconnected');}catch(error){setError(error);}finally{setBusy(false);}
  }
  const connected=pairing?links.data?.items.find(link=>link.id===pairing.id)?.pairedAt:active?.pairedAt;
  const expired=!!pairing&&now>=Date.parse(pairing.pairingExpiresAt);
  const qr=pairing?.qrCodes.find(item=>item.address===address);
  const content=<>
      <ol className="pairing-steps"><li>Connect the phone and computer to the same Wi-Fi.</li><li>On your phone, tap <strong>Pair with computer</strong>.</li><li>Point the phone camera at the QR below.</li></ol>
      {busy&&!pairing&&<Loading/>}
      {connected?<div role="status" className="notice pairing-success"><CheckCircle2 size={28}/><div><strong>Phone paired. You can start scanning.</strong><p>The phone stays paired across bills until you disconnect or sign out.</p></div></div>:pairing&&<>
        {expired?<div role="alert" className="notice">This QR has expired. Select “Show new QR” and scan again.</div>:qr?<div className="pairing-qr"><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr.svg)} alt="Scan with the Nanda app to pair this phone" width="288" height="288"/><strong>Scan to pair your phone</strong><p className="small muted">Single use · expires {showroomDate(pairing.pairingExpiresAt)}</p></div>:<p className="error">No Wi-Fi address found. Connect the computer to Wi-Fi and show a new QR.</p>}
        {pairing.qrCodes.length>1&&<div className="field"><label htmlFor="pairing-network">Computer network</label><select id="pairing-network" value={address} onChange={event=>setAddress(event.target.value)}>{pairing.qrCodes.map(item=><option key={item.address} value={item.address}>{item.address}</option>)}</select><small>If pairing cannot connect, choose the address on your phone’s Wi-Fi network.</small></div>}
      </>}
      <p className="footnote">Saving or closing a bill keeps the phone paired. Signing out or disconnecting ends the connection.</p>
      <ErrorBox error={error??links.error}/><div className="dialog-actions">{active&&<Button variant="secondary" disabled={busy} onClick={()=>void disconnect(active.id)}><Unplug size={16}/>Disconnect phone</Button>}{!connected&&<Button disabled={busy} onClick={()=>void generate()}><RefreshCw size={16}/>{busy?'Preparing QR…':'Show new QR'}</Button>}</div>
    </>;
  if(required)return <section className="panel billing-pairing"><div className="panel-heading"><div><h2>Pair your phone to start billing</h2><p>Scan the QR in the Nanda scanner app. This bill opens once your phone is paired.</p></div><Smartphone size={28}/></div><div className="billing-pairing-content">{content}</div></section>;
  return <><Button variant="secondary" className={minimal?'scanner-cta':''} disabled={busy} onClick={()=>{if(active){setOpen(true);setError(null);}else void generate();}}><Smartphone size={17}/>{minimal?'Pair phone / Scan gun':active?'Phone paired':'Pair phone'}</Button>
    {open&&<Modal open className={minimal?'scanner-pairing-modal':''} onClose={()=>setOpen(false)} title={minimal?'Pair phone / Scan gun':'Pair your phone with this bill'} description={minimal?'Pair your phone on the same Wi-Fi, or connect a USB barcode scanner.':'Scan this QR in the Nanda scanner app. Product scans will be added to this bill; you save the final bill on the computer.'}>{minimal?<div className="scanner-popup">
      {busy&&<Loading/>}
      {active?<p className="notice pairing-success">Phone paired. Scan a product to open its details and bill.</p>:pairing&&(expired?<p className="notice">QR expired. Show a new QR to pair.</p>:qr?<div className="pairing-qr"><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr.svg)} alt="Scan to pair your phone" width="224" height="224"/><strong>Scan with the Nanda app</strong></div>:<p className="error">Connect the computer to Wi-Fi to show a pairing QR.</p>)}
      {pairing&&pairing.qrCodes.length>1&&<div className="field"><label htmlFor="scanner-popup-network">Wi-Fi network</label><select id="scanner-popup-network" value={address} onChange={event=>setAddress(event.target.value)}>{pairing.qrCodes.map(item=><option key={item.address} value={item.address}>{item.address}</option>)}</select></div>}
      <ErrorBox error={error??links.error}/><div className="scanner-popup-actions">{active?<Button variant="secondary" disabled={busy} onClick={()=>void disconnect(active.id)}><Unplug size={16}/>Disconnect</Button>:<Button variant="secondary" disabled={busy} onClick={()=>void generate()}><RefreshCw size={16}/>New QR</Button>}<Button disabled={busy} onClick={()=>{onGunReady?.();setOpen(false);}}>Use scan gun</Button></div>
    </div>:content}</Modal>}
  </>;
}
