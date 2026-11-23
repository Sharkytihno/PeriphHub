// Réglages ciblés des claviers Wuque Studio, Kochi et Arbiter Studio via
// @openmouse/keyboard-protocol (AGPL-3.0-or-later, ui/vendor/openmouse-kb).
import { WuqueHidClient } from '../../vendor/openmouse-kb/drivers/wuque/hid.js';
import { KochiHidClient } from '../../vendor/openmouse-kb/drivers/kochi/hid.js';
import { ArbiterKeyboardHidClient } from '../../vendor/openmouse-kb/drivers/arbiter/hid.js';
import { ARBITER_LIGHT_EFFECTS } from '../../vendor/openmouse-kb/arbiter/index.js';
import {
  WUQUE_PRODUCTS, WUQUE_GLOBAL_COMMAND, WUQUE_GROUP, WUQUE_LIST_ACCESS,
  encodeWuqueReportRateSetting, decodeWuqueReportRate, decodeWuqueReportRateList,
} from '../../vendor/openmouse-kb/wuque/index.js';

const WUQUE_RATE_HZ = { r125hz: 125, r250hz: 250, r500hz: 500, r1khz: 1000, r2khz: 2000, r4khz: 4000, r8khz: 8000 };

async function wuqueSettings(client) {
  // Le client embarqué met d'ordinaire les lectures en cache. Ici la fréquence doit être
  // relue sur le clavier à chaque actualisation et après une écriture.
  const command = (access, rate) => client.enqueue(encodeWuqueReportRateSetting(access, rate),
    WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.reportRateSetting);
  const list = await command(WUQUE_LIST_ACCESS.readList);
  const names = list?.[2] === WUQUE_LIST_ACCESS.readList ? decodeWuqueReportRateList(list)?.list : null;
  const rates = [...new Set((names || []).map(name => WUQUE_RATE_HZ[name]).filter(Number.isFinite))].sort((a, b) => a - b);
  const read = async () => {
    const reply = await command(WUQUE_LIST_ACCESS.read);
    const rate = reply?.[2] === WUQUE_LIST_ACCESS.read ? WUQUE_RATE_HZ[decodeWuqueReportRate(reply)?.key] : undefined;
    if (!rates.includes(rate)) throw new Error('Fréquence USB illisible');
    return rate;
  };
  if (!rates.length) throw new Error('Fréquences USB illisibles');
  return {
    name: 'Wuque Studio ' + WUQUE_PRODUCTS[client.device.productId].name,
    cap: 'rate', choices: rates, read, initial: await read(),
    async write(hz) {
      const selector = Object.keys(WUQUE_RATE_HZ).find(name => WUQUE_RATE_HZ[name] === hz);
      const ack = await command(WUQUE_LIST_ACCESS.write, selector);
      if (ack?.[1] !== WUQUE_GLOBAL_COMMAND.reportRateSetting || await read() !== hz) {
        throw new Error('Le clavier n’a pas confirmé la fréquence USB');
      }
    },
  };
}

async function kochiSettings(client) {
  const status = await client.readStatus();
  return {
    name: 'Kochi ' + status.name, cap: 'systemMode', choices: ['win', 'mac'], initial: status.kochi.systemMode,
    read: () => client.readSystemMode(),
    write: mode => client.setSystemMode(mode),
    rows: inst => [field('Mode du clavier', segmented([{ v: 'win', label: 'Windows' }, { v: 'mac', label: 'macOS' }],
      inst.state.systemMode, mode => drvSet(inst, 'Mode du clavier', 'systemMode', mode)))],
  };
}

async function arbiterSettings(client) {
  const product = client.requireProduct();
  const readLight = async () => {
    const light = await client.readLightEffect();
    if (light.effect >= ARBITER_LIGHT_EFFECTS.length) throw new Error('Effet de rétroéclairage inconnu');
    return light;
  };
  const name = product.name.startsWith('Arbiter ') ? product.name : 'Arbiter ' + product.name;
  return {
    name, cap: 'backlight', choices: [false, true], initial: (await readLight()).on,
    read: async () => (await readLight()).on,
    async write(on) {
      const current = await readLight();
      // Le rapport contient tout l'effet. Relire ses paramètres avant de ne changer que l'interrupteur.
      if (current.on !== on) await client.setLightEffect({ ...current, on });
    },
    rows: inst => [field('Rétroéclairage', segmented([{ v: true, label: 'Allumé' }, { v: false, label: 'Éteint' }],
      inst.state.backlight, on => drvSet(inst, 'Rétroéclairage', 'backlight', on)))],
  };
}

const KEYBOARD_SETTINGS = [
  [WuqueHidClient, wuqueSettings],
  [KochiHidClient, kochiSettings],
  [ArbiterKeyboardHidClient, arbiterSettings],
];

const keyboardProtocol = dev => KEYBOARD_SETTINGS.find(([Client]) => Client.isSupported(dev));
export const extraKeyboardMatch = dev => !!keyboardProtocol(dev);

export async function extraKeyboardConnect(group) {
  let error;
  for (const dev of group) {
    const protocol = keyboardProtocol(dev);
    if (!protocol) continue;
    const [Client, readSettings] = protocol;
    const client = new Client(dev);
    try {
      await client.open();
      const { name, cap, choices, initial, read, write, rows } = await readSettings(client);
      const state = { [cap]: initial };
      // Une relecture (y compris à la sortie de veille) et une modification ne doivent pas s'entrecroiser.
      let queue = Promise.resolve();
      const run = operation => {
        const current = queue.then(operation);
        queue = current.catch(() => {});
        return current;
      };
      const refresh = () => run(async () => { state[cap] = await read(); });
      const inst = {
        key: 'omk-extra-' + devId(dev).replace(':', '').toLowerCase(),
        name, kind: 'clavier', dev, state, caps: { [cap]: choices },
        restoreCaps: cap === 'rate' ? [] : [cap],
        source: 'Protocole d’OpenMouse (AGPL-3.0), non testé sur matériel dans PeriphHub. Les réglages d’origine sont gardés avant la première modification.',
        refresh,
        reapply: refresh, // relire après la veille sans écrire dans le profil actif du clavier
        set: (setting, value) => run(async () => {
          if (setting !== cap || !choices.includes(value)) throw new Error('Réglage non proposé par ce clavier');
          await write(value);
          state[cap] = value;
        }),
        release: () => { void client.close().catch(() => {}); },
      };
      if (rows) inst.rows = () => rows(inst);
      return [inst];
    } catch (e) {
      await client.close().catch(() => {});
      error = e;
    }
  }
  if (error) throw error;
  return [];
}
