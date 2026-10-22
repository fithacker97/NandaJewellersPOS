import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { z, uuidSchema, amountSchema, quantitySchema, productSchema, productEditSchema, employeeSchema, customerSchema } from '@nanda/shared';
import { config, projectRoot } from './config.js';
import { db, transaction } from './db.js';
import { AppError, ensure } from './errors.js';
import { authenticate, csrfToken, hashToken, login, safeEqual, type Actor } from './services/auth.js';
import { createProduct, editProduct, archiveProduct, listProducts } from './services/catalog.js';
import { changeStock } from './services/stock.js';
import { createEmployee, editEmployee, employeePricing, resetEmployeePassword, updateBusiness, updateRates } from './services/settings.js';
import { attachPhoto, MAX_PHOTO_BYTES, uploadPhoto } from './services/photos.js';
import { storage } from './services/storage.js';
import { audit } from './services/audit.js';
import { getCurrentDraft, scanDraft, updateLine, updateCustomer, discardDraft, issueInvoice, findInvoice } from './services/billing.js';
import { dashboard, inventoryCsv, movementsCsv } from './services/reports.js';
import { createScannerLink, pairScanner, sendScannerScan, scannerPhoneStatus, scannerLinks, revokeScanner, disconnectScannerToken } from './services/scanner.js';
import { barcodeSvg, invoicePdf } from './services/documents.js';
declare global { namespace Express { interface Request { actor: Actor } } }
export const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'",'blob:','data:'], styleSrc: ["'self'","'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], fontSrc: ["'self'"] } } }));
app.use(express.json({ limit: '32kb' })); app.use(cookieParser());
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control','no-store'); next(); });
const cookie = { httpOnly: true, secure: config.production, sameSite: 'strict' as const, path: '/api' };
const admin = (req: Request, _res: Response, next: NextFunction) => { ensure(req.actor.role === 'ADMIN',403,'FORBIDDEN','Administrator access required.'); next(); };
const id = (req: Request) => uuidSchema.parse(req.params.id);
const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(150).optional(),
}).strict();
const productsQuery = listQuery.extend({ metal: z.enum(['GOLD','SILVER']).optional(), stock: z.enum(['in','low','out']).optional(), sort: z.enum(['newest','name','quantity','weight']).default('newest'), previewUserId: uuidSchema.optional() });
const scannerPairLimit=rateLimit({windowMs:5*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'PAIRING_LIMIT',message:'Too many pairing attempts. Wait five minutes.'}}});
const scannerScanLimit=rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'SCANNER_LIMIT',message:'Too many scans. Wait a moment and retry.'}}});
const scannerBearer=(req:Request)=>{const token=req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];ensure(token,401,'SCANNER_DISCONNECTED','Connect the scanner in Billing first.');return token;};
// These narrowly scoped native-app routes do not use session cookies.
// All normal showroom writes below still require exact origin and CSRF validation.
app.post('/api/scanner/pair',scannerPairLimit,async(req,res)=>{
  ensure(!req.get('origin')||req.get('origin')===config.origin,403,'INVALID_ORIGIN','Pair using the native scanner app.');
  const input=z.object({code:z.string().trim().regex(/^\d{8}$/)}).strict().parse(req.body);
  res.json(await pairScanner(input.code));
});
app.post('/api/scanner/scan',scannerScanLimit,async(req,res)=>{
  ensure(!req.get('origin')||req.get('origin')===config.origin,403,'INVALID_ORIGIN','Use the native scanner app.');
  const input=z.object({barcode:z.string().min(1).max(100),eventKey:z.string().min(10).max(100).regex(/^[A-Za-z0-9-]+$/)}).strict().parse(req.body);
  res.json(await sendScannerScan(scannerBearer(req),input.barcode,input.eventKey));
});
app.post('/api/scanner/disconnect',scannerScanLimit,async(req,res)=>{ensure(!req.get('origin')||req.get('origin')===config.origin,403,'INVALID_ORIGIN','Use the native scanner app.');z.object({}).strict().parse(req.body??{});res.json(await disconnectScannerToken(scannerBearer(req)));});
app.get('/api/scanner/status',scannerScanLimit,async(req,res)=>res.json(await scannerPhoneStatus(scannerBearer(req))));

app.use('/api', (req, _res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) ensure(req.get('origin') === config.origin,403,'INVALID_ORIGIN','Request origin is not allowed.');
  next();
});
app.get('/api/health', async (_req,res) => { await db.$queryRaw`SELECT 1`; res.json({ status:'ok' }); });
const loginLimit = rateLimit({ windowMs: 15*60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true, message: { error: { code:'LOGIN_LIMIT',message:'Too many login attempts. Try again in 15 minutes.' } } });
app.post('/api/auth/login',loginLimit,async(req,res)=>{
  const values=z.object({ email:z.string().email().max(160), password:z.string().min(1).max(128) }).strict().parse(req.body);
  const session=await login(values.email,values.password);
  res.cookie('nanda_session',session.token,{...cookie,expires:session.expiresAt}).json({user:session.user,csrfToken:session.csrfToken,expiresAt:session.expiresAt});
});
app.use('/api',async(req,_res,next)=>{
  const actor=await authenticate(req.cookies.nanda_session);
  ensure(actor,401,'UNAUTHENTICATED','Please sign in to continue.');
  req.actor=actor;
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const token=req.get('x-csrf-token')??'';
    ensure(safeEqual(token,csrfToken(req.cookies.nanda_session)),403,'INVALID_CSRF','Your session needs refreshing. Reload and try again.');
  }
  next();
});
app.post('/api/scanner/connections',async(req,res)=>{z.object({}).strict().parse(req.body??{});res.status(201).json(await createScannerLink(req.actor));});
app.get('/api/scanner/connections',async(req,res)=>res.json(await scannerLinks(req.actor)));
app.delete('/api/scanner/connections/:id',async(req,res)=>res.json(await revokeScanner(req.actor,id(req))));

app.get('/api/auth/me',(req,res)=>res.json({user:req.actor,csrfToken:csrfToken(req.cookies.nanda_session)}));
app.post('/api/auth/logout',async(req,res)=>{await transaction(async tx=>{await tx.session.deleteMany({where:{id:hashToken(req.cookies.nanda_session)}});await tx.scannerLink.updateMany({where:{userId:req.actor.id,revokedAt:null},data:{revokedAt:new Date()}});const draft=await tx.invoiceDraft.findUnique({where:{currentKey:req.actor.id}});if(draft){await tx.invoiceDraftLine.deleteMany({where:{draftId:draft.id}});await tx.invoiceDraft.update({where:{id:draft.id},data:{customerName:'',customerPhone:'',note:'',revision:{increment:1}}});}});res.clearCookie('nanda_session',cookie).json({loggedOut:true});});
app.get('/api/dashboard',async(req,res)=>res.json(await dashboard(req.actor)));
app.get('/api/products',async(req,res)=>res.json(await listProducts(req.actor,productsQuery.parse(req.query))));
app.post('/api/products',admin,async(req,res)=>res.status(201).json(await createProduct(req.actor,productSchema.parse(req.body))));
app.get('/api/products/lookup/:barcode',async(req,res)=>{const barcode=z.string().min(1).max(100).parse(req.params.barcode);res.json(await listProducts(req.actor,{page:1,pageSize:1,sort:'newest'},undefined,barcode));});
app.get('/api/products/:id',async(req,res)=>res.json(await listProducts(req.actor,{page:1,pageSize:1,sort:'newest'},id(req))));
app.patch('/api/products/:id',admin,async(req,res)=>res.json(await editProduct(req.actor,id(req),productEditSchema.parse(req.body))));
app.delete('/api/products/:id',admin,async(req,res)=>{
  const body=z.object({reason:z.string().trim().min(3).max(500),expectedQuantity:z.number().int().nonnegative()}).strict().parse(req.body);
  res.json(await archiveProduct(req.actor,id(req),body.reason,body.expectedQuantity));
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_PHOTO_BYTES,files:1,fields:0}});
app.post('/api/uploads/photos',admin,upload.single('photo'),async(req,res)=>{ensure(req.file,400,'PHOTO_REQUIRED','Choose a photo.');const photo=await uploadPhoto(req.file.buffer,req.actor.id);res.status(201).json({id:photo.id,url:'/api/photos/'+photo.id});});
app.post('/api/products/:id/photo',admin,upload.single('photo'),async(req,res)=>{
  const productId=id(req);ensure(req.file,400,'PHOTO_REQUIRED','Choose a photo.');
  const photo=await uploadPhoto(req.file.buffer,req.actor.id);
  await transaction(async tx=>{const p=await tx.product.findUnique({where:{id:productId}});ensure(p?.active,404,'PRODUCT_UNAVAILABLE','Product unavailable.');await attachPhoto(tx,productId,photo.id,req.actor.id);await tx.product.update({where:{id:productId},data:{updatedBy:req.actor.id,version:{increment:1}}});await audit(tx,req.actor.id,'PRODUCT_PHOTO_REPLACE',productId);});
  res.json({id:photo.id,url:'/api/photos/'+photo.id});
});
app.delete('/api/products/:id/photo',admin,async(req,res)=>{
  const productId=id(req);
  await transaction(async tx=>{const p=await tx.product.findUnique({where:{id:productId}});ensure(p?.active,404,'PRODUCT_UNAVAILABLE','Product unavailable.');await attachPhoto(tx,productId,null,req.actor.id);await tx.product.update({where:{id:productId},data:{updatedBy:req.actor.id,version:{increment:1}}});await audit(tx,req.actor.id,'PRODUCT_PHOTO_REMOVE',productId);});
  res.json({removed:true});
});
app.get('/api/photos/:id',async(req,res)=>{
  const query=z.object({thumbnail:z.literal('1').optional()}).strict().parse(req.query);
  const photo=await db.productPhoto.findUnique({where:{id:id(req)},include:{product:{select:{active:true}}}});
  ensure(photo && (photo.product?.active || req.actor.role==='ADMIN' && (photo.productId || photo.ownerId===req.actor.id)),404,'PHOTO_NOT_FOUND','Photo unavailable.');
  res.type('image/webp').send(await storage.read(query.thumbnail?photo.thumbnailKey:photo.key));
});
app.get('/api/products/:id/barcode',async(req,res)=>{
  const query=z.object({download:z.literal('1').optional()}).strict().parse(req.query);
  const product=await db.product.findFirst({where:{id:id(req),active:true}});ensure(product,404,'PRODUCT_NOT_FOUND','Product unavailable.');
  if(query.download)res.attachment(product.barcode+'.svg');
  res.type('image/svg+xml').send(barcodeSvg(product.barcode));
});
app.get('/api/rates',admin,async(_req,res)=>{
  const rates=await db.metalRate.findMany(); const ids=rates.map(r=>r.updatedBy).filter((v):v is string=>!!v);
  const users=await db.user.findMany({where:{id:{in:ids}},select:{id:true,name:true}});
  res.json(rates.map(r=>({...r,actorName:users.find(u=>u.id===r.updatedBy)?.name??'Initial configuration'})));
});
app.patch('/api/rates',admin,async(req,res)=>res.json(await updateRates(req.actor,z.object({gold:amountSchema,silver:amountSchema}).strict().parse(req.body))));
app.get('/api/employees',admin,async(req,res)=>{
  const q=listQuery.parse(req.query); const where={role:'EMPLOYEE' as const,...(q.q?{OR:[{name:{contains:q.q,mode:'insensitive' as const}},{email:{contains:q.q,mode:'insensitive' as const}}]}:{})};
  const [items,count]=await Promise.all([db.user.findMany({where,select:{id:true,name:true,email:true,active:true,createdAt:true,pricing:{select:{gold:true,silver:true,updatedAt:true}}},orderBy:{name:'asc'},take:q.pageSize,skip:(q.page-1)*q.pageSize}),db.user.count({where})]);res.json({items,count,page:q.page,pageSize:q.pageSize});
});
app.post('/api/employees',admin,async(req,res)=>res.status(201).json(await createEmployee(req.actor,employeeSchema.parse(req.body))));
app.patch('/api/employees/:id',admin,async(req,res)=>res.json(await editEmployee(req.actor,id(req),z.object({name:z.string().trim().min(2).max(100).optional(),active:z.boolean().optional()}).strict().parse(req.body))));
app.patch('/api/employees/:id/pricing',admin,async(req,res)=>res.json(await employeePricing(req.actor,id(req),z.object({gold:amountSchema,silver:amountSchema}).strict().parse(req.body))));
app.post('/api/employees/:id/reset-password',admin,loginLimit,async(req,res)=>{const input=z.object({adminPassword:z.string().min(1).max(128),newPassword:z.string().min(12).max(128)}).strict().parse(req.body);res.json(await resetEmployeePassword(req.actor,id(req),input.adminPassword,input.newPassword));});
app.post('/api/stock/receipts',async(req,res)=>res.json(await changeStock(req.actor,z.object({productId:uuidSchema,quantity:quantitySchema,reference:z.string().trim().max(500).optional()}).strict().parse(req.body))));
app.post('/api/stock/adjustments',admin,async(req,res)=>res.json(await changeStock(req.actor,z.object({productId:uuidSchema,quantity:z.number().int().min(-100000).max(100000).refine(v=>v!==0,'Enter a nonzero adjustment'),reference:z.string().trim().min(3).max(500)}).strict().parse(req.body),true)));
app.get('/api/stock/movements',async(req,res)=>{
  const q=listQuery.extend({type:z.enum(['OPENING','RECEIPT','SALE','ADJUSTMENT','ARCHIVE_REMOVAL']).optional(),productId:uuidSchema.optional()}).parse(req.query);
  const where={...(q.type?{type:q.type}:{}),...(q.productId?{productId:q.productId}:{}),...(q.q?{OR:[{productName:{contains:q.q,mode:'insensitive' as const}},{barcode:{contains:q.q,mode:'insensitive' as const}}]}:{})};
  const [items,count]=await Promise.all([db.stockMovement.findMany({where,include:{actor:{select:{name:true}}},orderBy:{createdAt:'desc'},take:q.pageSize,skip:(q.page-1)*q.pageSize}),db.stockMovement.count({where})]);res.json({items,count,page:q.page,pageSize:q.pageSize});
});
app.get('/api/invoice-drafts/current',async(req,res)=>res.json(await getCurrentDraft(req.actor)));
app.post('/api/invoice-drafts/current/scan',async(req,res)=>{const input=z.object({barcode:z.string().min(1).max(100)}).strict().parse(req.body);res.json(await scanDraft(req.actor,input.barcode));});
app.patch('/api/invoice-drafts/current/lines/:id',async(req,res)=>res.json(await updateLine(req.actor,id(req),z.object({quantity:quantitySchema}).strict().parse(req.body).quantity)));
app.delete('/api/invoice-drafts/current/lines/:id',async(req,res)=>res.json(await updateLine(req.actor,id(req),null)));
app.patch('/api/invoice-drafts/current/customer',async(req,res)=>res.json(await updateCustomer(req.actor,customerSchema.parse(req.body))));
app.delete('/api/invoice-drafts/current',async(req,res)=>res.json(await discardDraft(req.actor)));
app.post('/api/invoice-drafts/current/issue',async(req,res)=>res.json(await issueInvoice(req.actor,z.object({draftId:uuidSchema,issuanceKey:uuidSchema,quoteToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body))));
app.get('/api/invoices',async(req,res)=>{
  const q=listQuery.extend({from:z.string().date().optional(),to:z.string().date().optional()}).parse(req.query);
  const where={...(req.actor.role==='EMPLOYEE'?{sellerId:req.actor.id}:{}),...(q.q?{OR:[{number:{contains:q.q,mode:'insensitive' as const}},{customerName:{contains:q.q,mode:'insensitive' as const}}]}:{}),...((q.from||q.to)?{issuedAt:{...(q.from?{gte:new Date(q.from+'T00:00:00+05:30')}:{}),...(q.to?{lte:new Date(q.to+'T23:59:59.999+05:30')}:{})}}:{})};
  const [items,count]=await Promise.all([db.invoice.findMany({where,select:{id:true,number:true,issuedAt:true,customerName:true,sellerName:true,total:true,totalPieces:true,totalWeight:true},orderBy:{issuedAt:'desc'},take:q.pageSize,skip:(q.page-1)*q.pageSize}),db.invoice.count({where})]);res.json({items,count,page:q.page,pageSize:q.pageSize});
});
app.get('/api/invoices/:id',async(req,res)=>res.json(await findInvoice(req.actor,id(req))));
app.get('/api/invoices/:id/pdf',async(req,res)=>invoicePdf(await findInvoice(req.actor,id(req)),res));
app.get('/api/exports/inventory.csv',async(req,res)=>res.attachment('nanda-inventory.csv').type('text/csv').send(await inventoryCsv(req.actor)));
app.get('/api/exports/stock-movements.csv',async(_req,res)=>res.attachment('nanda-stock-movements.csv').type('text/csv').send(await movementsCsv()));
app.get('/api/business',admin,async(_req,res)=>res.json(await db.businessSettings.findUniqueOrThrow({where:{id:1}})));
app.patch('/api/business',admin,async(req,res)=>res.json(await updateBusiness(req.actor,z.object({name:z.string().trim().min(2).max(120),address:z.string().trim().max(500),phone:z.string().trim().max(50),lowStockThreshold:z.number().int().min(0).max(10000)}).strict().parse(req.body))));
app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint unavailable.'}}));
if(config.production){const web=path.join(projectRoot,'../frontend/dist');app.use(express.static(web));app.get('/{*path}',(_req,res)=>res.sendFile(path.join(web,'index.html')));}
app.use((error: unknown,_req: Request,res: Response,_next: NextFunction)=>{
  if(error instanceof z.ZodError){res.status(400).json({error:{code:'VALIDATION',message:'Check the entered values.',fields:error.flatten()}});return;}
  if(error instanceof AppError){res.status(error.status).json({error:{code:error.code,message:error.message,details:error.details}});return;}
  if(error instanceof multer.MulterError){res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:{code:'UPLOAD_REJECTED',message:'Choose one photo up to 8 MB.'}});return;}
  if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002'){res.status(409).json({error:{code:'ALREADY_EXISTS',message:'This record already exists. Use a unique login identifier.'}});return;}
  if(typeof error==='object'&&error!==null&&'type' in error&&error.type==='entity.too.large'){res.status(413).json({error:{code:'REQUEST_TOO_LARGE',message:'The request body is too large.'}});return;}
  if(error instanceof SyntaxError){res.status(400).json({error:{code:'INVALID_JSON',message:'Invalid request data.'}});return;}
  console.error('Request failed:',error instanceof Error ? error.message : 'Unknown error');
  res.status(500).json({error:{code:'INTERNAL_ERROR',message:'The operation could not be completed. Try again.'}});
});
