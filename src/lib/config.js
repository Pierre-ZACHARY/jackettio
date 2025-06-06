export default {
  // Server port
  port: parseInt(process.env.PORT || 4000),
  // https://expressjs.com/en/guide/behind-proxies.html
  trustProxy: boolOrString(process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal'),
  // Jacket instance url
  jackettUrl: process.env.JACKETT_URL || 'http://localhost:9117',
  // Jacket API key
  jackettApiKey: process.env.JACKETT_API_KEY || '',
  //  The Movie Database Access Token. Configure to use TMDB rather than cinemeta.
  tmdbAccessToken: process.env.TMDB_ACCESS_TOKEN || '', 
  // Data folder for cache database, torrent files ... Must be persistent in production
  dataFolder: process.env.DATA_FOLDER || '/tmp',
  // Cache configuration
  cacheType: process.env.CACHE_TYPE || 'sqlite', // 'sqlite' or 'redis'
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || 6379),
  redisDb: parseInt(process.env.REDIS_DB || 0),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  // Enable localtunnel feature
  localtunnel: (process.env.LOCALTUNNEL || 'false') === 'true',
  // Addon ID
  addonId: process.env.ADDON_ID || 'community.stremio.jackettio',
  // Addon Name
  addonName: process.env.ADDON_NAME || 'Jackettio',
  // Addon Description
  addonDescription: process.env.ADDON_DESCRIPTION || 'Stremio addon that resolve streams using Jackett and Debrid. It seamlessly integrates with private trackers.',
  // Addon Icon
  addonIcon: process.env.ADDON_ICON || 'https://avatars.githubusercontent.com/u/15383019?s=48&v=4',
  // When hosting a public instance with a private tracker, you must configure this setting to:
  // - Request the user's passkey on the /configure page.
  // - Replace your passkey "REPLACE_PASSKEY" with theirs when sending uncached torrents to the debrid.
  // If you do not configure this setting with private tracker, your passkey could be exposed to users who add uncached torrents.
  replacePasskey: process.env.REPLACE_PASSKEY || '',
  // The URL where the user can locate their passkey (typically the tracker URL).
  replacePasskeyInfoUrl: process.env.REPLACE_PASSKEY_INFO_URL || '',
  // The passkey pattern
  replacePasskeyPattern: process.env.REPLACE_PASSKEY_PATTERN || '[a-zA-Z0-9]+',
  // List of config keys that user can't configure
  immulatableUserConfigKeys: commaListToArray(process.env.IMMULATABLE_USER_CONFIG_KEYS || ''),
  // Welcome message in /configure page. Markdown format
  welcomeMessage: process.env.WELCOME_MESSAGE || '',
  // Trust the cf-connecting-ip header
  trustCfIpHeader: (process.env.TRUST_CF_IP_HEADER || 'false') === 'true',
  // Rate limit interval in seconds to resolve stream
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || 60 * 60),
  // Rate limit the number of requests to resolve stream
  rateLimitRequest: parseInt(process.env.RATE_LIMIT_REQUEST || 150),
  // Time (in seconds) needed to identify an indexer as slow
  slowIndexerDuration: parseInt(process.env.SLOW_INDEXER_DURATION || 20) * 1000,
  // Time window (in seconds) to monitor and count slow indexer requests (only requests within this period are considered)
  slowIndexerWindow: parseInt(process.env.SLOW_INDEXER_WINDOW || 1800) * 1000,
  // Number of consecutive slow requests within the time window to disable the indexer
  slowIndexerRequest: parseInt(process.env.SLOW_INDEXER_REQUEST || 5),

  defaultUserConfig: {
    qualities: commaListToArray(process.env.DEFAULT_QUALITIES || '0, 720, 1080').map(v => parseInt(v)),
    excludeKeywords: commaListToArray(process.env.DEFAULT_EXCLUDE_KEYWORDS || ''),
    maxTorrents: parseInt(process.env.DEFAULT_MAX_TORRENTS || 8),
    priotizeLanguages: commaListToArray(process.env.DEFAULT_PRIOTIZE_LANGUAGES || ''),
    priotizePackTorrents:  parseInt(process.env.DEFAULT_PRIOTIZE_PACK_TORRENTS || 2),
    forceCacheNextEpisode: (process.env.DEFAULT_FORCE_CACHE_NEXT_EPISODE || 'false') === 'true',
    sortCached: sortCommaListToArray(process.env.DEFAULT_SORT_CACHED || 'quality:true, size:true'),
    sortUncached: sortCommaListToArray(process.env.DEFAULT_SORT_UNCACHED || 'seeders:true'),
    hideUncached: (process.env.DEFAULT_HIDE_UNCACHED || 'false') === 'true',
    indexers: commaListToArray(process.env.DEFAULT_INDEXERS || 'all'),
    indexerTimeoutSec: parseInt(process.env.DEFAULT_INDEXER_TIMEOUT_SEC || 60),
    passkey: '',
    // If not defined, the original title is used for search. If defined, the title in the given language is used for search
    // format: ISO 639-1, example: en
    metaLanguage: process.env.DEFAULT_META_LANGUAGE || '',
    enableMediaFlow: (process.env.DEFAULT_ENABLE_MEDIAFLOW || 'false') === 'true',
    mediaflowProxyUrl: process.env.DEFAULT_MEDIAFLOW_PROXY_URL || '',
    mediaflowApiPassword: process.env.DEFAULT_MEDIAFLOW_API_PASSWORD || '',
    mediaflowPublicIp: process.env.DEFAULT_MEDIAFLOW_PUBLIC_IP || '',
    useStremThru: (process.env.DEFAULT_USE_STREMTHRU || 'true') === 'true',
    stremthruUrl: process.env.STREMTHRU_URL || 'https://stremthru.13377001.xyz',
    debridId: process.env.DEFAULT_DEBRID_ID || 'realdebrid'
  },

  qualities: [
    {value: 0, label: 'Unknown'},
    {value: 360, label: '360p'},
    {value: 480, label: '480p'},
    {value: 720, label: '720p'},
    {value: 1080, label: '1080p'},
    {value: 2160, label: '4K'}
  ],
  sorts: [
    {value: [['quality', true], ['seeders', true]], label: 'By quality then seeders'},
    {value: [['quality', true], ['size', true]], label: 'By quality then size'},
    {value: [['seeders', true]], label: 'By seeders'},
    {value: [['quality', true]], label: 'By quality'},
    {value: [['size', true]], label: 'By size'}
  ],
  languages: [
    {value: 'multi',      emoji: '🌎', iso639: '',   pattern: 'multi'},
    {value: 'arabic',     emoji: '🇦🇪', iso639: 'ar', pattern: 'arabic'},
    {value: 'chinese',    emoji: '🇨🇳', iso639: 'zh', pattern: 'chinese'},
    {value: 'german',     emoji: '🇩🇪', iso639: 'de', pattern: 'german'},
    {value: 'english',    emoji: '🇺🇸', iso639: 'en', pattern: '(eng(lish)?)'},
    {value: 'spanish',    emoji: '🇪🇸', iso639: 'es', pattern: 'spa(nish)?'},
    {value: 'french',     emoji: '🇫🇷', iso639: 'fr', pattern: 'fre(nch)?'},
    {value: 'dutch',      emoji: '🇳🇱', iso639: 'nl', pattern: 'dutch'},
    {value: 'italian',    emoji: '🇮🇹', iso639: 'it', pattern: 'ita(lian)?'},
    {value: 'lithuanian', emoji: '🇱🇹', iso639: 'lt', pattern: 'lithuanian'},
    {value: 'korean',     emoji: '🇰🇷', iso639: 'ko', pattern: 'korean'},
    {value: 'portuguese', emoji: '🇵🇹', iso639: 'pt', pattern: 'portuguese'},
    {value: 'brazilian', emoji: '🇧🇷', iso639: 'pt-br', pattern: 'portuguese'},
    {value: 'russian',    emoji: '🇷🇺', iso639: 'ru', pattern: 'rus(sian)?'},
    {value: 'swedish',    emoji: '🇸🇪', iso639: 'sv', pattern: 'swedish'},
    {value: 'tamil',      emoji: '🇮🇳', iso639: 'ta', pattern: 'tamil'},
    {value: 'turkish',    emoji: '🇹🇷', iso639: 'tr', pattern: 'turkish'}
  ].map(lang => {
    lang.label = `${lang.emoji} ${lang.value.charAt(0).toUpperCase() + lang.value.slice(1)}`;
    lang.pattern = new RegExp(` ${lang.pattern} `, 'i');
    return lang;
  })
}

function commaListToArray(str){
  return str.split(',').map(str => str.trim()).filter(Boolean);
}

function sortCommaListToArray(str){
  return commaListToArray(str).map(sort => {
    const [key, reverse] = sort.split(':');
    return [key.trim(), reverse.trim() == 'true'];
  });
}

function boolOrString(str){
  if(str.trim().toLowerCase() == 'true'){
    return true;
  }else if(str.trim().toLowerCase() == 'false'){
    return false;
  }else{
    return str.trim();
  }
}
