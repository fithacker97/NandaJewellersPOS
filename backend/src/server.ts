import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { cleanupPhotos } from './services/photos.js';
const server=app.listen(config.port,()=>console.log('Nanda Jewellers API: http://localhost:'+config.port));
const cleanup=setInterval(()=>{void cleanupPhotos().catch(error=>console.error('Photo cleanup failed:',error.message));void db.session.deleteMany({where:{expiresAt:{lt:new Date()}}}).catch(error=>console.error('Session cleanup failed:',error.message));},3600000);
cleanup.unref();
function stop(){clearInterval(cleanup);server.close(()=>void db.$disconnect());}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
