import '../config.js';
import { cleanupPhotos } from '../services/photos.js';
import { db } from '../db.js';
try { console.log('Removed abandoned photo records:',await cleanupPhotos());console.log('Removed expired sessions:',(await db.session.deleteMany({where:{expiresAt:{lt:new Date()}}})).count); } finally {await db.$disconnect();}
