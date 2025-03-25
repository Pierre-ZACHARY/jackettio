import debridlink from "./debrid/debridlink.js";
import alldebrid from "./debrid/alldebrid.js";
import realdebrid from './debrid/realdebrid.js';
import premiumize from './debrid/premiumize.js';
import stremthru from './debrid/stremthru.js';
import pikpak from './debrid/pikpak.js';
import easydebrid from './debrid/easydebrid.js';
import offcloud from './debrid/offcloud.js';
import torbox from './debrid/torbox.js';
export {ERROR} from './debrid/const.js';

const debrid = {debridlink, alldebrid, realdebrid, premiumize, stremthru, pikpak, easydebrid, offcloud, torbox};

// Propriété pour vérifier si la vérification de cache est disponible
export const cacheCheckAvailable = true;

export function instance(userConfig) {
  if (!debrid[userConfig.debridId]) {
    throw new Error(`Debrid service "${userConfig.debridId} not exists`);
  }
  
  // Si StremThru est activé et qu'un service autre que StremThru est sélectionné, utiliser StremThru comme wrapper
  if (userConfig.useStremThru && userConfig.stremthruUrl && userConfig.debridId !== 'stremthru') {
    // Créer une configuration StremThru qui utilise le service de débridage sélectionné
    const stremthruConfig = {
      ...userConfig,
      debridId: 'stremthru',
      stremthruStore: userConfig.debridId
    };
    return new stremthru(stremthruConfig);
  }
  
  return new debrid[userConfig.debridId](userConfig);
}

export async function list() {
  const values = [];
  for (const instance of Object.values(debrid)) {
    values.push({
      id: instance.id,
      name: instance.name,
      shortName: instance.shortName,
      configFields: instance.configFields
    });
  }
  return values;
}
