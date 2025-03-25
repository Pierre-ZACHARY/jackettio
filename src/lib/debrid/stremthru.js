// Status cache to avoid unnecessary API calls
const StatusCache = {
  data: {},
  set: function(hash, status) {
    this.data[hash] = {
      status: status,
      timestamp: Date.now()
    };
  },
  get: function(hash) {
    const cacheEntry = this.data[hash];
    // Cache validity duration: 5 minutes
    if (cacheEntry && (Date.now() - cacheEntry.timestamp) < 5 * 60 * 1000) {
      return cacheEntry.status;
    }
    return null;
  },
  clear: function() {
    this.data = {};
  }
};

import {createHash} from 'crypto';
import {ERROR} from './const.js';
import {wait, isVideo} from '../util.js';

export default class StremThru {

  static id = 'stremthru';
  static name = 'StremThru';
  static shortName = 'ST';
  static cacheCheckAvailable = true;
  static configFields = [
    {
      type: 'text', 
      name: 'stremthruUrl', 
      label: `StremThru URL`, 
      required: true, 
      value: 'https://stremthru.13377001.xyz'
    },
    {
      type: 'text', 
      name: 'stremthruStore', 
      label: `StremThru Store`, 
      required: true, 
      value: 'realdebrid'
    },
    {
      type: 'text', 
      name: 'debridApiKey', 
      label: `API Key`, 
      required: true
    }
  ];

  #apiKey;
  #storeType;
  #baseUrl;
  #ip;

  constructor(userConfig) {
    Object.assign(this, this.constructor);
    this.#apiKey = userConfig.debridApiKey;
    this.#storeType = userConfig.stremthruStore || 'realdebrid';
    this.#baseUrl = userConfig.stremthruUrl || 'https://stremthru.13377001.xyz';
    this.#ip = userConfig.ip || '';
    
    // Use original abbreviations for debrid services
    const debridShortNames = {
      'realdebrid': 'RD',
      'alldebrid': 'AD',
      'debridlink': 'DL',
      'premiumize': 'PM',
      'pikpak': 'PP',
      'easydebrid': 'ED',
      'offcloud': 'OC',
      'torbox': 'TB'
    };
    
    // If the store is known, use its original abbreviation, otherwise use ST
    this.shortName = debridShortNames[this.#storeType] || 'ST';
  }

  async getTorrentsCached(torrents, isValidCachedFiles) {
    if (!torrents || torrents.length === 0) {
      return [];
    }
    
    const hashList = torrents.map(torrent => torrent.infos.infoHash).filter(hash => hash);
    
    if (hashList.length === 0) {
      return [];
    }
    
    const hashGroups = [];
    for (let i = 0; i < hashList.length; i += 50) {
      hashGroups.push(hashList.slice(i, i + 50));
    }

    const cachedResults = []; // Torrents en cache à retourner
    
    // Assigner un statut à tous les torrents
    for (const group of hashGroups) {
      try {
        const magnets = group.map(hash => `magnet:?xt=urn:btih:${hash}`);
        const query = magnets.join(',');
        const res = await this.#request('GET', `/magnets/check?magnet=${encodeURIComponent(query)}&client_ip=${this.#ip}&sid=${torrents[0]?.metaInfos?.stremioId || ''}`);
        
        if (res && res.data && res.data.items) {
          for (const item of res.data.items) {
            const hash = item.hash;
            const torrent = torrents.find(t => t.infos.infoHash === hash);
            
            if (torrent) {
              // Stocker le statut dans le cache
              StatusCache.set(hash, item.status);
              
              // Stocker le statut pour tous les torrents
              torrent.status = item.status;
              
              // Pour les torrents qui sont en cache ou téléchargés,
              // les ajouter aux résultats
              if (item.status === 'cached' || item.status === 'downloaded') {
                const files = item.files.map(file => ({
                  name: file.name,
                  size: file.size
                }));
                
                if (files.length > 0 && isValidCachedFiles(files)) {
                  cachedResults.push(torrent);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error checking cache status: ${err.message}`);
      }
    }

    return cachedResults;
  }

  async getProgressTorrents(torrents) {
    // StremThru does not directly provide this information
    // Return an empty object for each torrent
    return torrents.reduce((progress, torrent) => {
      progress[torrent.infos.infoHash] = {
        percent: 0,
        speed: 0
      };
      return progress;
    }, {});
  }

  async getFilesFromHash(infoHash) {
    return this.getFilesFromMagnet(`magnet:?xt=urn:btih:${infoHash}`, infoHash);
  }

  async getFilesFromMagnet(magnet, infoHash) {
    try {
      // Add the magnet
      const addRes = await this.#request('POST', '/magnets', {
        body: JSON.stringify({ magnet })
      });
      
      if (!addRes || !addRes.data || !addRes.data.id) {
        throw new Error('Failed to add magnet');
      }
      
      const magnetId = addRes.data.id;
      
      // Wait for the magnet to be processed
      let magnetInfo;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        magnetInfo = await this.#request('GET', `/magnets/${magnetId}`);
        
        if (magnetInfo && magnetInfo.data) {
          if (magnetInfo.data.status === 'downloaded' || magnetInfo.data.status === 'cached') {
            break;
          }
        }
        
        await wait(2000);
        attempts++;
      }
      
      if (!magnetInfo || !magnetInfo.data || !magnetInfo.data.files || magnetInfo.data.files.length === 0) {
        throw new Error('No files found or magnet processing timeout');
      }
      
      return magnetInfo.data.files.map(file => {
        return {
          name: file.name.split('/').pop(),
          size: file.size,
          id: `${magnetId}:${file.index}`,
          url: '',
          ready: magnetInfo.data.status === 'downloaded' || magnetInfo.data.status === 'cached',
          status: magnetInfo.data.status // Add the status for the icon
        };
      });
    } catch (err) {
      console.error(`Error getting files from magnet: ${err.message}`);
      throw err;
    }
  }

  async getFilesFromBuffer(buffer, infoHash) {
    // StremThru does not directly support uploading torrent files
    // Use the hash instead
    return this.getFilesFromHash(infoHash);
  }

  async getDownload(file) {
    try {
      const [magnetId, fileIndex] = file.id.split(':');
      
      // Get the magnet information
      const magnetInfo = await this.#request('GET', `/magnets/${magnetId}`);
      
      if (!magnetInfo || !magnetInfo.data) {
        throw new Error('Failed to get magnet info');
      }
      
      if (magnetInfo.data.status !== 'downloaded' && magnetInfo.data.status !== 'cached') {
        throw new Error(ERROR.NOT_READY);
      }
      
      // Find the corresponding file
      const targetFile = magnetInfo.data.files.find(f => f.index.toString() === fileIndex);
      
      if (!targetFile || !targetFile.link) {
        throw new Error('File not found or link not available');
      }
      
      // Generate the download link
      const linkRes = await this.#request('POST', '/link/generate', {
        body: JSON.stringify({ link: targetFile.link })
      });
      
      if (!linkRes || !linkRes.data || !linkRes.data.link) {
        throw new Error('Failed to generate download link');
      }
      
      return linkRes.data.link;
    } catch (err) {
      console.error(`Error getting download link: ${err.message}`);
      throw err;
    }
  }

  async getUserHash() {
    return createHash('md5').update(this.#apiKey).digest('hex');
  }

  /**
   * Check the current status of torrents
   * @param {Array} torrents - List of torrents to check
   * @returns {Promise<Object>} - An object with the statuses for each hash
   */
  async checkTorrentsStatus(torrents) {
    if (!torrents || torrents.length === 0) {
      return {};
    }
    
    const hashList = torrents.map(torrent => torrent.infos.infoHash).filter(hash => hash);
    
    if (hashList.length === 0) {
      return {};
    }
    
    const hashGroups = [];
    for (let i = 0; i < hashList.length; i += 50) {
      hashGroups.push(hashList.slice(i, i + 50));
    }

    const statusMap = {};
    
    for (const group of hashGroups) {
      try {
        const magnets = group.map(hash => `magnet:?xt=urn:btih:${hash}`);
        const query = magnets.join(',');
        const res = await this.#request('GET', `/magnets/check?magnet=${encodeURIComponent(query)}&client_ip=${this.#ip}&sid=${torrents[0]?.metaInfos?.stremioId || ''}`);
        
        if (res && res.data && res.data.items) {
          for (const item of res.data.items) {
            statusMap[item.hash] = item.status;
          }
        }
      } catch (err) {
        console.error(`Error checking torrent status: ${err.message}`);
      }
    }

    return statusMap;
  }

  async addTorrent(magnetUrl) {
    const res = await this.#request('POST', '/torrents/add', {
      body: JSON.stringify({
        magnet: magnetUrl,
        client_ip: this.#ip
      })
    });

    if (!res || !res.data || !res.data.id) {
      throw new Error('Failed to add torrent');
    }

    // Update the status in the cache - we know the status will be "queued" or "processing"
    const infoHash = magnetUrl.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
    if (infoHash) {
      StatusCache.set(infoHash, 'queued');
    }

    return res.data;
  }

  /**
   * Initialize the statuses in the cache from a list of torrents
   * @param {Array} torrents - List of torrents
   */
  async initTorrentStatuses(torrents) {
    if (!torrents || torrents.length === 0) {
      return;
    }
    
    const hashList = torrents.map(torrent => torrent.infos.infoHash).filter(hash => hash);
    
    if (hashList.length === 0) {
      return;
    }
    
    const hashGroups = [];
    for (let i = 0; i < hashList.length; i += 50) {
      hashGroups.push(hashList.slice(i, i + 50));
    }
    
    for (const group of hashGroups) {
      try {
        const magnets = group.map(hash => `magnet:?xt=urn:btih:${hash}`);
        const query = magnets.join(',');
        const res = await this.#request('GET', `/magnets/check?magnet=${encodeURIComponent(query)}&client_ip=${this.#ip}&sid=${torrents[0]?.metaInfos?.stremioId || ''}`);
        
        if (res && res.data && res.data.items) {
          for (const item of res.data.items) {
            const hash = item.hash;
            // Store the status in the cache
            StatusCache.set(hash, item.status);
            
            // Update the corresponding torrent
            const torrent = torrents.find(t => t.infos.infoHash === hash);
            if (torrent) {
              torrent.status = item.status;
            }
          }
        }
      } catch (err) {
        console.error(`Error initializing torrent statuses: ${err.message}`);
      }
    }
  }

  async #request(method, path, opts = {}) {
    opts = Object.assign(opts, {
      method,
      headers: { 
        'accept': 'application/json',
        'content-type': 'application/json',
        'X-StremThru-Store-Name': this.#storeType,
        'X-StremThru-Store-Authorization': `Bearer ${this.#apiKey}`,
        ...opts.headers 
      }
    });

    // Options for retries in case of error
    const maxRetries = 2;
    const retryDelay = 1000; // 1 second
    let retryCount = 0;
    let lastError = null;

    while (retryCount <= maxRetries) {
      try {
        const fullUrl = `${this.#baseUrl}/v0/store${path}`;
        
        console.log(`StremThru API request: ${method} ${fullUrl}`);
        const response = await fetch(fullUrl, opts);
        const data = await response.json();

        // Check if the response contains an error
        if (data.error) {
          const error = new Error(`StremThru API error: ${JSON.stringify(data.error)}`);
          error.data = { error: data.error };
          
          // If it's an authentication error or INTERNAL_SERVER_ERROR, we can retry
          if ((data.error.code === 'FORBIDDEN' || data.error.code === 'INTERNAL_SERVER_ERROR') && retryCount < maxRetries) {
            lastError = error;
            retryCount++;
            console.log(`StremThru API retry (${retryCount}/${maxRetries}) after error: ${data.error.code}`);
            await wait(retryDelay);
            continue;
          }
          
          throw error;
        }

        return data;
      } catch (err) {
        // If it's already a formatted error from us, throw it directly
        if (err.data && err.data.error) {
          // If we haven't reached the maximum number of retries, retry
          if (retryCount < maxRetries) {
            lastError = err;
            retryCount++;
            console.log(`StremThru request retry (${retryCount}/${maxRetries}) after error: ${err.message}`);
            await wait(retryDelay);
            continue;
          }
          
          throw err;
        }
        
        // Otherwise, format it
        console.error(`StremThru request error: ${err.message}`);
        const formattedError = new Error(`StremThru request error: ${err.message}`);
        formattedError.originalError = err;
        throw formattedError;
      }
    }

    // If we get here, all retries have failed
    if (lastError) {
      console.error(`StremThru request failed after ${maxRetries} retries: ${lastError.message}`);
      throw lastError;
    }
  }

  // Convert a StremThru status to the corresponding icon
  static getStatusIcon(status) {
    const statusIcons = {
      'cached': '⚡', // yellow lightning bolt for cached files
      'queued': '⏳', // hourglass for queued files
      'downloading': '⏬', // download in progress
      'processing': '⚙️', // processing in progress
      'downloaded': '✅', // download complete
      'uploading': '⏫', // upload in progress
      'failed': '❌', // failed
      'invalid': '⛔', // invalid
      'unknown': '❓', // unknown status
    };
    
    return statusIcons[status] || '❓'; // question mark by default
  }

  /**
   * Set the status of a torrent in the cache
   * @param {string} hash - Hash of the torrent
   * @param {string} status - Status to set
   */
  static setStatus(hash, status) {
    if (hash) {
      StatusCache.set(hash, status);
    }
  }

  /**
   * Get the status of a torrent from the cache
   * @param {string} hash - Hash of the torrent
   * @returns {string|null} - The status or null if not found
   */
  static getStatus(hash) {
    return hash ? StatusCache.get(hash) : null;
  }
}
