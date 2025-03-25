import pLimit from 'p-limit';
import {parseWords, numberPad, sortBy, bytesToSize, wait, promiseTimeout} from './util.js';
import config from './config.js';
import cache from './cache.js';
import { updateUserConfigWithMediaFlowIp, applyMediaflowProxyIfNeeded } from './mediaflowProxy.js';
import * as meta from './meta.js';
import * as jackett from './jackett.js';
import * as debrid from './debrid.js';
import * as torrentInfos from './torrentInfos.js';

const slowIndexers = {};

const actionInProgress = {
  getTorrents: {},
  getDownload: {}
};

function parseStremioId(stremioId){
  const [id, season, episode] = stremioId.split(':');
  return {id, season: parseInt(season || 0), episode: parseInt(episode || 0)};
}

async function getMetaInfos(type, stremioId, language){
  const {id, season, episode} = parseStremioId(stremioId);
  if(type == 'movie'){
    return meta.getMovieById(id, language);
  }else if(type == 'series'){
    return meta.getEpisodeById(id, season, episode, language);
  }else{
    throw new Error(`Unsuported type ${type}`);
  }
}

async function mergeDefaultUserConfig(userConfig){
  config.immulatableUserConfigKeys.forEach(key => delete userConfig[key]);
  userConfig = Object.assign({}, config.defaultUserConfig, userConfig);
  userConfig = await updateUserConfigWithMediaFlowIp(userConfig);
  return userConfig;
}

function priotizeItems(allItems, priotizeItems, max){
  max = max || 0;
  if(typeof(priotizeItems) == 'function'){
    priotizeItems = allItems.filter(priotizeItems);
    if(max > 0)priotizeItems.splice(max);
  }
  if(priotizeItems && priotizeItems.length){
    allItems = allItems.filter(item => !priotizeItems.find(i => i == item));
    allItems.unshift(...priotizeItems);
  }
  return allItems;
}

function searchEpisodeFile(files, season, episode){
  return files.find(file => file.name.includes(`S${numberPad(season, 2)}E${numberPad(episode, 3)}`))
    || files.find(file => file.name.includes(`S${numberPad(season, 2)}E${numberPad(episode, 2)}`))
    || files.find(file => file.name.includes(`${season}${numberPad(episode, 2)}`))
    || files.find(file => file.name.includes(`${numberPad(episode, 2)}`))
    || false;
}

function getSlowIndexerStats(indexerId){
  slowIndexers[indexerId] = (slowIndexers[indexerId] || []).filter(item => new Date() - item.date < config.slowIndexerWindow);
  return {
    min: Math.min(...slowIndexers[indexerId].map(item => item.duration)),
    avg: Math.round(slowIndexers[indexerId].reduce((acc, item) => acc + item.duration, 0) / slowIndexers[indexerId].length),
    max: Math.max(...slowIndexers[indexerId].map(item => item.duration)),
    count: slowIndexers[indexerId].length
  }
}

async function timeoutIndexerSearch(indexerId, promise, timeout){
  const start = new Date();
  const res = await promiseTimeout(promise, timeout).catch(err => []);
  const duration = new Date() - start;
  if(timeout > config.slowIndexerDuration){
    if(duration > config.slowIndexerDuration){
      console.log(`Slow indexer detected : ${indexerId} : ${duration}ms`);
      slowIndexers[indexerId].push({duration, date: new Date()});
    }else{
      slowIndexers[indexerId] = [];
    }
  }
  return res;
}

async function getTorrents(userConfig, metaInfos, debridInstance){

  while(actionInProgress.getTorrents[metaInfos.stremioId]){
    await wait(500);
  }
  actionInProgress.getTorrents[metaInfos.stremioId] = true;

  try {

    const {qualities, excludeKeywords, maxTorrents, sortCached, sortUncached, priotizePackTorrents, priotizeLanguages, indexerTimeoutSec} = userConfig;
    const {id, season, episode, type, stremioId, year} = metaInfos;

    let torrents = [];
    let startDate = new Date();

    console.log(`${stremioId} : Searching torrents ...`);

    const sortSearch = [['seeders', true]];
    const filterSearch = (torrent) => {
      if(!qualities.includes(torrent.quality))return false;
      const torrentWords = parseWords(torrent.name.toLowerCase());
      if(excludeKeywords.find(word => torrentWords.includes(word)))return false;
      return true;
    };
    const filterLanguage = (torrent) => {
      if(priotizeLanguages.length == 0)return true;
      return torrent.languages.find(lang => ['multi'].concat(priotizeLanguages).includes(lang.value));
    };
    const filterYear = (torrent) => !torrent.year || torrent.year == year;
    const filterSlowIndexer = (indexer) => config.slowIndexerRequest <= 0 || getSlowIndexerStats(indexer.id).count < config.slowIndexerRequest;

    let indexers = (await jackett.getIndexers());
    let availableIndexers = indexers.filter(indexer => indexer.searching[type].available);
    let availableFastIndexers = availableIndexers.filter(filterSlowIndexer);
    if(availableFastIndexers.length)availableIndexers = availableFastIndexers;
    let userIndexers = availableIndexers.filter(indexer => (userConfig.indexers.includes(indexer.id) || userConfig.indexers.includes('all')));

    if(userIndexers.length){
      indexers = userIndexers;
    }else if(availableIndexers.length){
      console.log(`${stremioId} : User defined indexers "${userConfig.indexers.join(', ')}" not available, fallback to all "${type}" indexers`);
      indexers = availableIndexers;
    }else if(indexers.length){
      console.log(`${stremioId} : User defined indexers "${userConfig.indexers.join(', ')}" or "${type}" indexers not available, fallback to all indexers`);
    }else{
      throw new Error(`${stremioId} : No indexer configured in jackett`);
    }

    console.log(`${stremioId} : ${indexers.length} indexers selected : ${indexers.map(indexer => indexer.title).join(', ')}`);

    if(type == 'movie'){

      const promises = indexers.map(indexer => timeoutIndexerSearch(indexer.id, jackett.searchMovieTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000));
      torrents = [].concat(...(await Promise.all(promises)));

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      const yearTorrents = torrents.filter(filterYear);
      if(yearTorrents.length)torrents = yearTorrents;
      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch));
      torrents = priotizeItems(torrents, filterLanguage, Math.max(1, Math.round(maxTorrents * 0.33)));
      torrents = torrents.slice(0, maxTorrents + 2);

    }else if(type == 'series'){

      const episodesPromises = indexers.map(indexer => timeoutIndexerSearch(indexer.id, jackett.searchEpisodeTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000));
      // const packsPromises = indexers.map(indexer => promiseTimeout(jackett.searchSeasonTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000).catch(err => []));
      const packsPromises = indexers.map(indexer => timeoutIndexerSearch(indexer.id, jackett.searchSerieTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000));

      const episodesTorrents = [].concat(...(await Promise.all(episodesPromises))).filter(filterSearch);
      // const packsTorrents = [].concat(...(await Promise.all(packsPromises))).filter(torrent => filterSearch(torrent) && parseWords(torrent.name.toUpperCase()).includes(`S${numberPad(season)}`));
      const packsTorrents = [].concat(...(await Promise.all(packsPromises))).filter(torrent => {
        if(!filterSearch(torrent))return false;
        const words = parseWords(torrent.name.toLowerCase());
        const wordsStr = words.join(' ');
        if(
          // Season x
          wordsStr.includes(`season ${season}`)
          // SXX
          || words.includes(`s${numberPad(season, 2)}`)
        ){
          return true;
        }
        // From SXX to SXX
        const range = wordsStr.match(/s([\d]{2,}) s([\d]{2,})/);
        if(range && season >= parseInt(range[1]) && season <= parseInt(range[2])){
          return true;
        }
        // Complete without season number (serie pack)
        if(words.includes('complete') && !wordsStr.match(/ (s[\d]{2,}|season [\d]) /)){
          return true;
        }
        return false;
      });

      torrents = [].concat(episodesTorrents, packsTorrents);

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      const yearTorrents = torrents.filter(filterYear);
      if(yearTorrents.length)torrents = yearTorrents;
      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch));
      torrents = priotizeItems(torrents, filterLanguage, Math.max(1, Math.round(maxTorrents * 0.33)));
      torrents = torrents.slice(0, maxTorrents + 2);

      if(priotizePackTorrents > 0 && packsTorrents.length && !torrents.find(t => packsTorrents.includes(t))){
        const bestPackTorrents = packsTorrents.slice(0, Math.min(packsTorrents.length, priotizePackTorrents));
        torrents.splice(bestPackTorrents.length * -1, bestPackTorrents.length, ...bestPackTorrents);
      }

    }

    console.log(`${stremioId} : ${torrents.length} torrents filtered, get torrents infos ...`);
    startDate = new Date();

    const limit = pLimit(5);
    torrents = await Promise.all(torrents.map(torrent => limit(async () => {
      try {
        torrent.infos = await promiseTimeout(torrentInfos.get(torrent), Math.min(30, indexerTimeoutSec)*1000);
        return torrent;
      }catch(err){
        console.log(`${stremioId} Failed getting torrent infos for ${torrent.id} from indexer ${torrent.indexerId}`);
        console.log(`${stremioId} ${torrent.link.replace(/apikey=[a-z0-9\-]+/, 'apikey=****')}`, err);
        return false;
      }
    })));
    torrents = torrents.filter(torrent => torrent && torrent.infos)
      .filter((torrent, index, items) => items.findIndex(t => t.infos.infoHash == torrent.infos.infoHash) === index)
      .slice(0, maxTorrents);

    console.log(`${stremioId} : ${torrents.length} torrents infos found in ${(new Date() - startDate) / 1000}s`);

    if(torrents.length == 0){
      throw new Error(`No torrent infos for type ${type} and id ${stremioId}`);
    }

    if(debridInstance){

      try {

        const isValidCachedFiles = type == 'series' ? files => !!searchEpisodeFile(files, season, episode) : files => true;
        
        // Obtenir les torrents en cache et leurs statuts
        let statusTorrents = [];
        let cachedTorrents = [];
        
        if (debridInstance.constructor.id === 'stremthru') {
          // For StremThru, retrieve status of all torrents
          // We store the status for all torrents, but only keep
          // the torrents in cache in cachedTorrents to not disturb existing behavior
          
          // Save statuses
          const origStatuses = {};
          for (const torrent of torrents) {
            if (torrent.status) {
              origStatuses[torrent.infos.infoHash] = torrent.status;
            }
          }
          
          // Obtain cached torrents and their status
          cachedTorrents = (await debridInstance.getTorrentsCached(torrents, isValidCachedFiles)).map(torrent => {
            torrent.isCached = true;
            return torrent;
          });
          
          // Restore statuses for all torrents
          for (const torrent of torrents) {
            if (origStatuses[torrent.infos.infoHash]) {
              torrent.status = origStatuses[torrent.infos.infoHash];
            }
          }
        } else {
          // For other services, normal behavior
          cachedTorrents = (await debridInstance.getTorrentsCached(torrents, isValidCachedFiles)).map(torrent => {
            torrent.isCached = true;
            return torrent;
          });
        }
        
        const uncachedTorrents = torrents.filter(torrent => cachedTorrents.indexOf(torrent) === -1);

        if(config.replacePasskey && !(userConfig.passkey && userConfig.passkey.match(new RegExp(config.replacePasskeyPattern)))){
          uncachedTorrents.forEach(torrent => {
            if(torrent.infos.private){
              torrent.disabled = true;
              torrent.infoText = 'Uncached torrent require a passkey configuration';
            }
          });
        }

        console.log(`${stremioId} : ${cachedTorrents.length} cached torrents on ${debridInstance.shortName}`);

        torrents = priotizeItems(cachedTorrents.sort(sortBy(...sortCached)), filterLanguage);

        if(!userConfig.hideUncached || !debrid.cacheCheckAvailable){
          torrents.push(...priotizeItems(uncachedTorrents.sort(sortBy(...sortUncached)), filterLanguage));
        }
      
        const progress = await debridInstance.getProgressTorrents(torrents);
        torrents.forEach(torrent => torrent.progress = progress[torrent.infos.infoHash] || null);

      }catch(err){

        console.log(`${stremioId} : ${debridInstance.shortName} : ${err.message || err}`);

        if(err.message == debrid.ERROR.EXPIRED_API_KEY){
          torrents.forEach(torrent => {
            torrent.disabled = true;
            torrent.infoText = 'Unable to verify cache (+): Expired Debrid API Key.';
          });
        }

      }

    }

    return torrents;

  }finally{

    delete actionInProgress.getTorrents[metaInfos.stremioId];

  }

}

async function prepareNextEpisode(userConfig, metaInfos, debridInstance){

  try {

    const {stremioId} = metaInfos;
    const nextEpisodeIndex = metaInfos.episodes.findIndex(e => e.episode == metaInfos.episode && e.season == metaInfos.season) + 1;
    const nextEpisode = metaInfos.episodes[nextEpisodeIndex] || false;

    if(nextEpisode){

      metaInfos = await meta.getEpisodeById(metaInfos.id, nextEpisode.season, nextEpisode.episode, userConfig.metaLanguage);
      const torrents = await getTorrents(userConfig, metaInfos, debridInstance);

      // Cache next episode on debrid when not cached
      if(userConfig.forceCacheNextEpisode && torrents.length && !torrents.find(torrent => torrent.isCached)){
        console.log(`${stremioId} : Force cache next episode (${metaInfos.episode}) on debrid`);
        const bestTorrent = torrents.find(torrent => !torrent.disabled);
        if(bestTorrent)await getDebridFiles(userConfig, bestTorrent.infos, debridInstance);
      }

    }

  }catch(err){

    if(err.message != debrid.ERROR.NOT_READY){
      console.log('cache next episode:', err);
    }

  }

}

async function getDebridFiles(userConfig, infos, debridInstance){

  if(infos.magnetUrl){

    return debridInstance.getFilesFromMagnet(infos.magnetUrl, infos.infoHash);

  }else{

    let buffer = await torrentInfos.getTorrentFile(infos);

    if(config.replacePasskey){

      if(infos.private && !userConfig.passkey){
        return debridInstance.getFilesFromHash(infos.infoHash);
      }

      if(!userConfig.passkey.match(new RegExp(config.replacePasskeyPattern))){
        throw new Error(`Invalid user passkey, pattern not match: ${config.replacePasskeyPattern}`);
      }

      const from = buffer.toString('binary');
      let to = from.replace(new RegExp(config.replacePasskey, 'g'), userConfig.passkey);
      const diffLength = from.length - to.length;
      const announceLength = from.match(/:announce([\d]+):/);
      if(diffLength && announceLength && announceLength[1]){
        to = to.replace(announceLength[0], `:announce${parseInt(announceLength[1]) - diffLength}:`);
      }
      buffer = Buffer.from(to, 'binary');

    }

    return debridInstance.getFilesFromBuffer(buffer, infos.infoHash);

  }

}

function getFile(files, type, season, episode){
  files = files.sort(sortBy('size', true));
  if(type == 'movie'){
    return files[0];
  }else if(type == 'series'){
    return searchEpisodeFile(files, season, episode) || files[0];
  }
}

export async function getStreams(userConfig, type, stremioId, publicUrl){

  userConfig = await mergeDefaultUserConfig(userConfig);
  const debridInstance = debrid.instance(userConfig);
  const {id, season, episode} = parseStremioId(stremioId);

  let metaInfos = await getMetaInfos(type, stremioId, userConfig.metaLanguage);

  const torrents = await getTorrents(userConfig, metaInfos, debridInstance);
  
  // Retrieve the torrents already clicked from localStorage
  const clickedHashes = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem('jackettio_clicked_torrents');
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(clickedHashes, parsed);
      }
    } catch (err) {
      console.error('Error when retrieving clicked torrents:', err);
    }
  }
  
  // Mark torrents as clicked if present in localStorage
  torrents.forEach(torrent => {
    if (torrent.infos && torrent.infos.infoHash && clickedHashes.includes(torrent.infos.infoHash)) {
      torrent.clicked = true;
    }
  });
  
  // Initialize torrent statuses if it's StremThru
  // This is much more efficient because it's a single request for all torrents
  if (debridInstance && debridInstance.constructor.id === 'stremthru' && debridInstance.initTorrentStatuses) {
    try {
      await debridInstance.initTorrentStatuses(torrents);
      console.log(`${stremioId} : Torrent statuses initialized`);
    } catch (err) {
      console.error(`Error when initializing statuses: ${err.message}`);
    }
  }
  
  if (!torrents.length) return [];

  // Prepare next episode torrents list
  if(type == 'series'){
    prepareNextEpisode({...userConfig, forceCacheNextEpisode: false}, metaInfos, debridInstance);
  }

  return torrents.map(torrent => {
    const file = getFile(torrent.infos.files || [], type, season, episode) || {};
    const quality = torrent.quality > 0 ? config.qualities.find(q => q.value == torrent.quality).label : '';
    const rows = [torrent.name];
    if(type == 'series' && file.name)rows.push(file.name);
    if(torrent.infoText)rows.push(`ℹ️ ${torrent.infoText}`);
    rows.push([`💾${bytesToSize(file.size || torrent.size)}`, `👥${torrent.seeders}`, `⚙️${torrent.indexerId}`, ...(torrent.languages || []).map(language => language.emoji)].join(' '));
    if(torrent.progress && !torrent.isCached){
      rows.push(`⬇️ ${torrent.progress.percent}% ${bytesToSize(torrent.progress.speed)}/s`);
    }
    
    // Use the appropriate status icon if available, otherwise default behavior
    let statusIcon = '';
    if (debridInstance.constructor.id === 'stremthru') {
      if (torrent.isCached) {
        // For cached torrents, use the yellow lightning bolt
        statusIcon = '⚡';
      } else {
        // For all others, use the blue square with a downward arrow
        statusIcon = '⬇️';
      }
    } else if (torrent.isCached) {
      // Default behavior for cached torrents from other services
      statusIcon = '+';
    }
    
    return {
      name: `[${debridInstance.shortName}${statusIcon}] ${userConfig.enableMediaFlow ? '🕵🏼‍♂️ ' : ''}${config.addonName} ${quality}`,
      title: rows.join("\n"),
      url: torrent.disabled ? '#' : `${publicUrl}/${btoa(JSON.stringify(userConfig))}/download/${type}/${stremioId}/${torrent.id}/${file.name || torrent.name}`
    };
  });

}

export async function getDownload(userConfig, type, stremioId, torrentId){

  userConfig = await mergeDefaultUserConfig(userConfig);
  const debridInstance = debrid.instance(userConfig);
  const infos = await torrentInfos.getById(torrentId);
  const {id, season, episode} = parseStremioId(stremioId);
  const cacheKey = `download:2:${await debridInstance.getUserHash()}${userConfig.enableMediaFlow ? ':mfp': ''}:${stremioId}:${torrentId}`;
  let files;
  let download;
  let waitMs = 0;

  // Record this torrent as "clicked" in localStorage
  if (infos && infos.infoHash && typeof window !== 'undefined' && window.localStorage) {
    try {
      let clickedHashes = [];
      const stored = window.localStorage.getItem('jackettio_clicked_torrents');
      if (stored) {
        clickedHashes = JSON.parse(stored);
      }
      
      // Add the hash if it's not already present
      if (!clickedHashes.includes(infos.infoHash)) {
        clickedHashes.push(infos.infoHash);
        window.localStorage.setItem('jackettio_clicked_torrents', JSON.stringify(clickedHashes));
        console.log(`${stremioId} : Torrent ${infos.infoHash} marked as clicked`);
      }
    } catch (err) {
      console.error('Error when recording clicked torrent:', err);
    }
  }

  // Immediately update status to "queued" so that the hourglass is displayed
  // even if the rest fails due to API errors
  if (debridInstance && debridInstance.constructor.id === 'stremthru' && debridInstance.constructor.setStatus && infos && infos.infoHash) {
    debridInstance.constructor.setStatus(infos.infoHash, 'queued');
    console.log(`${stremioId} : Status updated to 'queued' for ${infos.infoHash}`);
  }

  while(actionInProgress.getDownload[cacheKey]){
    await wait(Math.min(300, waitMs+=50));
  }
  actionInProgress.getDownload[cacheKey] = true;

  try {

    // Prepare next episode debrid cache
    if(type == 'series' && userConfig.forceCacheNextEpisode){
      getMetaInfos(type, stremioId, userConfig.metaLanguage).then(metaInfos => prepareNextEpisode(userConfig, metaInfos, debridInstance));
    }

    download = await cache.get(cacheKey);
    if(download)return download;

    console.log(`${stremioId} : ${debridInstance.shortName} : ${infos.infoHash} : get files ...`);
    
    // We have already updated the status at the beginning of the function
    files = await getDebridFiles(userConfig, infos, debridInstance);
    console.log(`${stremioId} : ${debridInstance.shortName} : ${infos.infoHash} : ${files.length} files found`);

    download = await debridInstance.getDownload(getFile(files, type, season, episode));

    if(download){
      download = applyMediaflowProxyIfNeeded(download, userConfig);
      await cache.set(cacheKey, download, {ttl: 3600});
      return download;
    }

    // If no download is available, redirect to the not_ready.mp4 video
    console.log(`${stremioId} : No download available, redirect to not_ready.mp4`);
    return {
      url: `${publicUrl}/static/videos/not_ready.mp4`
    };

  }finally{

    delete actionInProgress.getDownload[cacheKey];

  }

}
