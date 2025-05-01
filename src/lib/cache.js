import sqlite3 from 'sqlite3';
import sqliteStore from 'cache-manager-sqlite';
import cacheManager from 'cache-manager'; 
import redisStore from 'cache-manager-ioredis';
import Redis from 'ioredis';
import config from './config.js';
import {wait} from './util.js';

let cache;
let db; 

if (config.cacheType === 'redis') {
  console.log(`Using Redis cache: ${config.redisHost}:${config.redisPort}`);
  const redisClient = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    db: config.redisDb,
    maxRetriesPerRequest: null 
  });

  redisClient.on('error', (err) => {
    console.error('Redis Cache Error:', err);
  });

  cache = await cacheManager.caching({
    store: redisStore,
    redisInstance: redisClient,
    ttl: 86400 
  });

} else { 
  console.log(`Using SQLite cache: ${config.dataFolder}/cache.db`);
  db = new sqlite3.Database(`${config.dataFolder}/cache.db`);

  cache = await cacheManager.caching({
    store: sqliteStore,
    path: `${config.dataFolder}/cache.db`,
    options: { ttl: 86400 } 
  });
}

export default cache;

export async function clean(){
  if (config.cacheType !== 'sqlite') {
    console.warn('Cache clean() is only applicable for SQLite cache.');
    return;
  }
  console.log('Cleaning SQLite cache...');
  await cache.set('_clean', 'todo', {ttl: 1});
  await wait(3e3);
  await cache.get('_clean');
  console.log('SQLite cache cleaned.');
}

export async function vacuum(){
  if (config.cacheType !== 'sqlite') {
    console.warn('Cache vacuum() is only applicable for SQLite cache.');
    return;
  }
  console.log('Vacuuming SQLite cache database...');
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('VACUUM', err => {
        if(err) {
          console.error('Error vacuuming SQLite DB:', err);
          return reject(err);
        }
        console.log('SQLite cache database vacuumed.');
        resolve();
      })
    });
  });
}
