import { AsusHidClient } from "./asus/hid.js";
import { AtkBitmouseHidClient } from "./atk/bitmouse-hid.js";
import { AtkHidClient } from "./atk/hid.js";
import { AttackSharkHidClient } from "./attackshark/hid.js";
import { DeluxHidClient } from "./delux/hid.js";
import { EggOp1HidClient } from "./endgame/egg-op1-hid.js";
import { EggOtHidClient } from "./endgame/egg-ot-hid.js";
import { FantechHidClient } from "./fantech/hid.js";
import { GearHubHidClient } from "./gearhub/hid.js";
import { eggWeCreate, eggWeIsSupported, eggWeSupportScore, isEggWeClient } from "./endgame/egg-we-control.js";
import { FinalmouseHidClient } from "./finalmouse/hid.js";
import { Keychron1kHidClient } from "./keychron/mouse-1k-hid.js";
import { Keychron4kHidClient } from "./keychron/mouse-4k-hid.js";
import { Keychron8kHidClient } from "./keychron/mouse-8k-hid.js";
import { Keychron8kNordicHidClient } from "./keychron/mouse-8k-nordic-hid.js";
import { KeychronNapeHidClient } from "./keychron/nape-hid.js";
import { LamzuAtlantisHidClient } from "./lamzu-atlantis/hid.js";
import { ScyroxHidClient } from "./scyrox/hid.js";
import { NoirM1NexHidClient } from "./noir/m1-nex-hid.js";
import { LamzuHidClient } from "./lamzu/hid.js";
import { LogitechHidppClient } from "./logitech/hidpp.js";
import { ModdoHidClient } from "./moddo/hid.js";
import { NinjutsoHidClient } from "./ninjutso/hid.js";
import { OrbitalHidClient } from "./orbital/hid.js";
import { RawmHidClient } from "./rawm/hid.js";
import { GravaStarHidClient } from "./gravastar/hid.js";
import { PulsarHidClient } from "./pulsar/pulsar-hid.js";
import { PulsarAresonHidClient } from "./pulsar/pulsar-areson-hid.js";
import { PulsarProHidClient } from "./pulsar/pulsar-pro-hid.js";
import { PulsarXs1HidClient } from "./pulsar/pulsar-xs1-hid.js";
import { RazerCobraHidClient } from "./razer/cobra-hid.js";
import { RazerHidClient } from "./razer/hid.js";
import { RazerViperHidClient } from "./razer/viper-hid.js";
import { RazerViperMiniHidClient } from "./razer/viper-mini-hid.js";
import { RazerViperV4ProHidClient } from "./razer/viper-v4-pro-hid.js";
import { TeevolutionHidClient } from "./teevolution/hid.js";
import { VgnF2HidClient } from "./vgn/hid.js";
import { VaxeeHidClient } from "./vaxee/hid.js";
import { WallhackKeyboardHidClient } from "./wallhack/keyboard-hid.js";
import { WallhackMouseHidClient } from "./wallhack/mouse-hid.js";
import { WLMouseHidClient } from "./wlmouse/hid.js";
import { WLMouseBeastX4kHidClient } from "./wlmouse/beast-x-4k-hid.js";
import { WootingHidClient } from "./wooting/hid.js";
import { ZaunkoenigHidClient } from "./zaunkoenig/hid.js";
import { CorsairHidClient } from "./corsair/hid.js";
import { CorsairBragiHidClient } from "./corsair/bragi-hid.js";
import { GWolvesHidClient } from "./gwolves/hid.js";
import { GWolvesXviHidClient } from "./gwolves/xvi-hid.js";
import { GWolvesXviNewHidClient } from "./gwolves/xvi-new-hid.js";
import { SteelSeriesRival3HidClient } from "./steelseries/hid.js";
import { SteelSeriesRival100HidClient } from "./steelseries/rival-100-hid.js";
import { SteelSeriesRival110HidClient } from "./steelseries/rival-110-hid.js";
import { SteelSeriesRival300HidClient } from "./steelseries/rival-300-hid.js";
import { SteelSeriesAerox3HidClient } from "./steelseries/aerox3-hid.js";
import { SteelSeriesAerox3WirelessHidClient } from "./steelseries/aerox3-wireless-hid.js";
import { SteelSeriesRival3WirelessHidClient } from "./steelseries/rival3-wireless-hid.js";
import { SteelSeriesAerox5HidClient } from "./steelseries/aerox5-hid.js";
import { SteelSeriesAerox5WirelessHidClient } from "./steelseries/aerox5-wireless-hid.js";
import { SteelSeriesRival650HidClient } from "./steelseries/rival650-hid.js";
import { SteelSeriesRival600HidClient } from "./steelseries/rival-600-hid.js";
import { SteelSeriesAerox9WirelessHidClient } from "./steelseries/aerox9-wireless-hid.js";
import { SteelSeriesRival310HidClient } from "./steelseries/rival310-hid.js";
import { SteelSeriesPrimePlusHidClient } from "./steelseries/prime-plus-hid.js";
import { SteelSeriesPrimeMiniWirelessHidClient } from "./steelseries/prime-mini-wireless-hid.js";
import { SteelSeriesPrimeMiniHidClient } from "./steelseries/prime-mini-hid.js";
import { SteelSeriesSenseiTenHidClient } from "./steelseries/sensei-ten-hid.js";
import { SteelSeriesSenseiRivalProHidClient } from "./steelseries/sensei-rival-pro-hid.js";
import { SteelSeriesSensei310HidClient } from "./steelseries/sensei-310-hid.js";
import { SteelSeriesRival5HidClient } from "./steelseries/rival-5-hid.js";
import { SteelSeriesRival3Gen2HidClient } from "./steelseries/rival-3-v2-hid.js";
import { SteelSeriesRival3WirelessV2HidClient } from "./steelseries/rival-3-wireless-v2-hid.js";
import { SteelSeriesAerox3WirelessGen2HidClient } from "./steelseries/aerox-3-wireless-gen2-hid.js";
import { SteelSeriesSenseiRawHidClient } from "./steelseries/sensei-raw-hid.js";
import { GloriousHidClient } from "./glorious/hid.js";
import { GloriousClassicHidClient } from "./glorious/classic-hid.js";
import { GloriousCore2HidClient } from "./glorious/core2-hid.js";
import { GloriousSinowealthHidClient } from "./glorious/sinowealth-hid.js";
import { MchoseHidClient } from "./mchose/hid.js";
import { MchoseDockHidClient } from "./mchose/dock-hid.js";
import { MchoseA5ProMaxHidClient } from "./mchose/a5-gen1-hid.js";
import { KsnakeHidClient } from "./ksnake/hid.js";
import { isNoirM2NexDevice } from "../ksnake/index.js";
import { MicrosoftHidClient } from "./microsoft/hid.js";
import { MotospeedHidClient } from "./motospeed/hid.js";
import { DareuHidClient } from "./dareu/hid.js";
import { RedragonHidClient } from "./redragon/hid.js";
import { RedragonM690ProHidClient } from "./redragon/m690-pro-hid.js";
import { FaterHidClient } from "./fater/hid.js";
import { IncottHidClient } from "./incott/hid.js";
import { HyperXHidClient } from "./hyperx/hid.js";
import { MchoseV3HidClient } from "./mchose/v3-hid.js";
import { KyuProMx1Client } from "./ryunix/kyu-pro-mx1-hid.js";
import { BytechHidClient } from "./bytech/hid.js";
import { RapooHidClient } from "./rapoo/hid.js";
import { CoolerMasterHidClient } from "./coolermaster/hid.js";
import { AjazzHidClient } from "./ajazz/hid.js";
import { AjazzAk820HidClient } from "./ajazz/ak820-hid.js";
import { HitscanHidClient } from "./hitscan/hid.js";
export const DEVICE_DRIVERS = [
    { brand: "IPI", supports: (device) => BytechHidClient.isSupported(device), create: (device) => new BytechHidClient(device), score: () => 9 },
    { brand: "ASUS", supports: (device) => AsusHidClient.isSupported(device), create: (device) => new AsusHidClient(device), score: () => 10, },
    { brand: "Dareu", supports: (device) => DareuHidClient.isSupported(device), create: (device) => new DareuHidClient(device), score: () => 9 },
    { brand: "Redragon", supports: (device) => RedragonHidClient.isSupported(device), create: (device) => new RedragonHidClient(device), score: () => 9 },
    // Shares SinoWealth's 0x258a with the Glorious classic line; disjoint by
    // product id, and the client refuses a settings block that is not the
    // M690 PRO's.
    { brand: "Redragon", supports: (device) => RedragonM690ProHidClient.isSupported(device), create: (device) => new RedragonM690ProHidClient(device), score: () => 9 },
    // Shares Holtek's 0x04d9 with Redragon; disjoint by product id and by usage
    // page (0xff00 here, 0xffa0 there).
    { brand: "Fater", supports: (device) => FaterHidClient.isSupported(device), create: (device) => new FaterHidClient(device), score: () => 7 },
    { brand: "Motospeed", supports: (device) => MotospeedHidClient.isSupported(device), create: (device) => new MotospeedHidClient(device), score: () => 7 },
    { brand: "Zaunkoenig", supports: (device) => ZaunkoenigHidClient.isSupported(device), create: (device) => new ZaunkoenigHidClient(device), score: () => 10 },
    { brand: "Corsair", supports: (device) => CorsairHidClient.isSupported(device), create: (device) => new CorsairHidClient(device), score: () => 8 },
    { brand: "Corsair", supports: (device) => CorsairBragiHidClient.isSupported(device), create: (device) => new CorsairBragiHidClient(device), score: () => 8 },
    { brand: "Finalmouse", supports: (device) => FinalmouseHidClient.isSupported(device), create: (device) => new FinalmouseHidClient(device), score: () => 10 },
    // Scored above EggWeHidClient.supportScore's ~50 ceiling: a 4K v2 dongle
    // (PID 0x1970) exposes WE-shaped sibling interfaces next to this one.
    { brand: "Endgame Gear", supports: (device) => EggOp1HidClient.isSupported(device), create: (device) => new EggOp1HidClient(device), score: () => 100 },
    // OT PIDs (0x1903/0x1905/0x1906) are disjoint from every K26/WE catalog by
    // product id, so this never contends with the drivers above.
    { brand: "Endgame Gear", supports: (device) => EggOtHidClient.isSupported(device), create: (device) => new EggOtHidClient(device), score: () => 100 },
    { brand: "Endgame Gear", supports: eggWeIsSupported, create: eggWeCreate, score: eggWeSupportScore },
    { brand: "Pulsar", supports: (device) => PulsarXs1HidClient.isSupported(device), create: (device) => new PulsarXs1HidClient(device), score: () => 8 },
    { brand: "Pulsar", supports: (device) => PulsarProHidClient.isSupported(device), create: (device) => new PulsarProHidClient(device), score: () => 8 },
    { brand: "Pulsar", supports: (device) => PulsarAresonHidClient.isSupported(device), create: (device) => new PulsarAresonHidClient(device), score: () => 8 },
    { brand: "GravaStar", supports: (device) => GravaStarHidClient.isSupported(device), create: (device) => new GravaStarHidClient(device), score: () => 7 },
    { brand: "Pulsar", supports: (device) => PulsarHidClient.isSupported(device), create: (device) => new PulsarHidClient(device), score: () => 7 },
    { brand: "Teevolution", supports: (device) => TeevolutionHidClient.isSupported(device), create: (device) => new TeevolutionHidClient(device), score: () => 7 },
    { brand: "VGN", supports: (device) => VgnF2HidClient.isSupported(device), create: (device) => new VgnF2HidClient(device), score: () => 7 },
    { brand: "VAXEE", supports: (device) => VaxeeHidClient.isSupported(device), create: (device) => new VaxeeHidClient(device), score: () => 7 },
    { brand: "Logitech", supports: (device) => LogitechHidppClient.isSupported(device), create: (device) => new LogitechHidppClient(device), score: (device) => LogitechHidppClient.supportScore(device) },
    { brand: "WLMouse", supports: (device) => WLMouseBeastX4kHidClient.isSupported(device), create: (device) => new WLMouseBeastX4kHidClient(device), score: () => 6 },
    { brand: "WLMouse", supports: (device) => WLMouseHidClient.isSupported(device), create: (device) => new WLMouseHidClient(device), score: () => 5 },
    { brand: "Lamzu", supports: (device) => LamzuHidClient.isSupported(device), create: (device) => new LamzuHidClient(device), score: () => 5 },
    { brand: "Noir Gear", supports: (device) => NoirM1NexHidClient.isSupported(device), create: (device) => new NoirM1NexHidClient(device), score: () => 8 },
    { brand: "Lamzu", supports: (device) => LamzuAtlantisHidClient.isSupported(device), create: (device) => new LamzuAtlantisHidClient(device), score: () => 5 },
    // Scyrox rides the Atlantis client on CompX's shared vendor id; its ids are
    // disjoint from Lamzu's own table and excluded from Pulsar's catch-all
    // 0x3554 claim.
    { brand: "Scyrox", supports: (device) => ScyroxHidClient.isSupported(device), create: (device) => new ScyroxHidClient(device), score: () => 6 },
    { brand: "moddoMOUSE", supports: (device) => ModdoHidClient.isSupported(device), create: (device) => new ModdoHidClient(device), score: () => 5 },
    { brand: "Ninjutso", supports: (device) => NinjutsoHidClient.isSupported(device), create: (device) => new NinjutsoHidClient(device), score: () => 7 },
    { brand: "Orbital", supports: (device) => OrbitalHidClient.isSupported(device), create: (device) => new OrbitalHidClient(device), score: () => 6 },
    { brand: "RAWM", supports: (device) => RawmHidClient.isSupported(device), create: (device) => new RawmHidClient(device), score: () => 7 },
    { brand: "Razer", supports: (device) => RazerHidClient.isSupported(device), create: (device) => new RazerHidClient(device), score: () => 6 },
    { brand: "Razer", supports: (device) => RazerCobraHidClient.isSupported(device), create: (device) => new RazerCobraHidClient(device), score: () => 6 },
    { brand: "Razer", supports: (device) => RazerViperMiniHidClient.isSupported(device), create: (device) => new RazerViperMiniHidClient(device), score: () => 6 },
    { brand: "Razer", supports: (device) => RazerViperHidClient.isSupported(device), create: (device) => new RazerViperHidClient(device), score: () => 6 },
    { brand: "ATK", supports: (device) => AtkBitmouseHidClient.isSupported(device), create: (device) => new AtkBitmouseHidClient(device), score: () => 7 },
    { brand: "ATK", supports: (device) => AtkHidClient.isSupported(device), create: (device) => new AtkHidClient(device), score: () => 5 },
    { brand: "Delux", supports: (device) => DeluxHidClient.isSupported(device), create: (device) => new DeluxHidClient(device), score: () => 6 },
    { brand: "Attack Shark", supports: (device) => AttackSharkHidClient.isSupported(device), create: (device) => new AttackSharkHidClient(device), score: () => 5 },
    { brand: "Razer", supports: (device) => RazerViperV4ProHidClient.isSupported(device), create: (device) => new RazerViperV4ProHidClient(device), score: () => 7 },
    // Launcher's order: the 0xffc1 collection, then 0x8c, then the 4K family's 0xff0a.
    { brand: "Keychron", supports: (device) => Keychron8kHidClient.isSupported(device), create: (device) => new Keychron8kHidClient(device), score: () => 7 },
    { brand: "Keychron", supports: (device) => Keychron1kHidClient.isSupported(device), create: (device) => new Keychron1kHidClient(device), score: () => 7 },
    { brand: "Keychron", supports: (device) => Keychron4kHidClient.isSupported(device), create: (device) => new Keychron4kHidClient(device), score: () => 7 },
    { brand: "Keychron", supports: (device) => Keychron8kNordicHidClient.isSupported(device), create: (device) => new Keychron8kNordicHidClient(device), score: () => 7 },
    { brand: "Keychron", supports: (device) => KeychronNapeHidClient.isSupported(device), create: (device) => new KeychronNapeHidClient(device), score: () => 6 },
    // Ahead of Fantech: GearHub-V5 mice (Lingbao M5 Pro, Attack Shark R2, …)
    // answer on the same VID 0x3151, usage page 0xFFFF, usage 0x02 interface
    // that FantechHidClient claims, but need the 2.4G relay handshake and the
    // Bit7 checksum that driver has no notion of. Scoped to the two receiver
    // product ids so it cannot shadow Fantech's own hardware. The client
    // identifies the specific model from the device id after connecting; the
    // registry label is the M5 Pro's brand (the fallback identity).
    { brand: "Lingbao", supports: (device) => GearHubHidClient.isSupported(device), create: (device) => new GearHubHidClient(device), score: () => 7 },
    { brand: "Fantech", supports: (device) => FantechHidClient.isSupported(device), create: (device) => new FantechHidClient(device), score: () => 5 },
    { brand: "Wooting", supports: (device) => WootingHidClient.isSupported(device), create: (device) => new WootingHidClient(device), score: () => 6 },
    { brand: "WALLHACK", supports: (device) => WallhackMouseHidClient.isSupported(device), create: (device) => new WallhackMouseHidClient(device), score: () => 8 },
    { brand: "WALLHACK", supports: (device) => WallhackKeyboardHidClient.isSupported(device), create: (device) => new WallhackKeyboardHidClient(device), score: () => 8 },
    { brand: "G-Wolves", supports: (device) => GWolvesHidClient.isSupported(device), create: (device) => new GWolvesHidClient(device), score: () => 7 },
    { brand: "G-Wolves", supports: (device) => GWolvesXviHidClient.isSupported(device), create: (device) => new GWolvesXviHidClient(device), score: () => 7 },
    { brand: "G-Wolves", supports: (device) => GWolvesXviNewHidClient.isSupported(device), create: (device) => new GWolvesXviNewHidClient(device), score: () => 7 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival3HidClient.isSupported(device), create: (device) => new SteelSeriesRival3HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival100HidClient.isSupported(device), create: (device) => new SteelSeriesRival100HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival110HidClient.isSupported(device), create: (device) => new SteelSeriesRival110HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival300HidClient.isSupported(device), create: (device) => new SteelSeriesRival300HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesAerox3HidClient.isSupported(device), create: (device) => new SteelSeriesAerox3HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesAerox3WirelessHidClient.isSupported(device), create: (device) => new SteelSeriesAerox3WirelessHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival3WirelessHidClient.isSupported(device), create: (device) => new SteelSeriesRival3WirelessHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesAerox5HidClient.isSupported(device), create: (device) => new SteelSeriesAerox5HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesAerox5WirelessHidClient.isSupported(device), create: (device) => new SteelSeriesAerox5WirelessHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival650HidClient.isSupported(device), create: (device) => new SteelSeriesRival650HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival600HidClient.isSupported(device), create: (device) => new SteelSeriesRival600HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesAerox9WirelessHidClient.isSupported(device), create: (device) => new SteelSeriesAerox9WirelessHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival310HidClient.isSupported(device), create: (device) => new SteelSeriesRival310HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesPrimePlusHidClient.isSupported(device), create: (device) => new SteelSeriesPrimePlusHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesPrimeMiniWirelessHidClient.isSupported(device), create: (device) => new SteelSeriesPrimeMiniWirelessHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesPrimeMiniHidClient.isSupported(device), create: (device) => new SteelSeriesPrimeMiniHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesSenseiTenHidClient.isSupported(device), create: (device) => new SteelSeriesSenseiTenHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesSenseiRivalProHidClient.isSupported(device), create: (device) => new SteelSeriesSenseiRivalProHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesSensei310HidClient.isSupported(device), create: (device) => new SteelSeriesSensei310HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival5HidClient.isSupported(device), create: (device) => new SteelSeriesRival5HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival3Gen2HidClient.isSupported(device), create: (device) => new SteelSeriesRival3Gen2HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesRival3WirelessV2HidClient.isSupported(device), create: (device) => new SteelSeriesRival3WirelessV2HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesAerox3WirelessGen2HidClient.isSupported(device), create: (device) => new SteelSeriesAerox3WirelessGen2HidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesSenseiRawHidClient.isSupported(device), create: (device) => new SteelSeriesSenseiRawHidClient(device), score: () => 6 },
    { brand: "Glorious", supports: (device) => GloriousHidClient.isSupported(device), create: (device) => new GloriousHidClient(device), score: () => 5 },
    { brand: "Glorious", supports: (device) => GloriousClassicHidClient.isSupported(device), create: (device) => new GloriousClassicHidClient(device), score: () => 5 },
    // Same vendor id as the classic family; disjoint by product id.
    { brand: "Glorious", supports: (device) => GloriousCore2HidClient.isSupported(device), create: (device) => new GloriousCore2HidClient(device), score: () => 5 },
    // Original wired Model O / D (SinoWealth 258a:0036 / 0033) and Model O
    // Eternal (3794:a000); disjoint from the classic family by product id.
    { brand: "Glorious", supports: (device) => GloriousSinowealthHidClient.isSupported(device), create: (device) => new GloriousSinowealthHidClient(device), score: () => 5 },
    { brand: "MCHOSE", supports: (device) => MchoseA5ProMaxHidClient.isSupported(device), create: (device) => new MchoseA5ProMaxHidClient(device), score: () => 8 },
    { brand: "MCHOSE", supports: (device) => MchoseHidClient.isSupported(device), create: (device) => new MchoseHidClient(device), score: () => 7 },
    { brand: "MCHOSE", supports: (device) => MchoseDockHidClient.isSupported(device), create: (device) => new MchoseDockHidClient(device), score: () => 7 },
    // The A7 V3 generation shares the V2 usage page but not its protocol; the
    // two matchers are kept disjoint by product id.
    { brand: "MCHOSE", supports: (device) => MchoseV3HidClient.isSupported(device), create: (device) => new MchoseV3HidClient(device), score: () => 7 },
    { brand: "K-snake", supports: (device) => KsnakeHidClient.isSupported(device), create: (device) => new KsnakeHidClient(device), score: () => 5 },
    // Shares VIDs 0xA8A4/0xA8A5 and the 0xFF01:0x10 collection with K-snake; the
    // two stay disjoint by product id (K-snake owns 0x2255).
    { brand: "AJAZZ", supports: (device) => AjazzHidClient.isSupported(device), create: (device) => new AjazzHidClient(device), score: () => 7 },
    { brand: "Microsoft", supports: (device) => MicrosoftHidClient.isSupported(device), create: (device) => new MicrosoftHidClient(device), score: () => 5 },
    // Shares vendor id 0x093a with Glorious (see vendors.ts), but claims only
    // its own two product ids, so the two drivers never contend for a device.
    { brand: "Incott", supports: (device) => IncottHidClient.isSupported(device), create: (device) => new IncottHidClient(device), score: () => 8 },
    { brand: "HyperX", supports: (device) => HyperXHidClient.isSupported(device), create: (device) => new HyperXHidClient(device), score: () => 5 },
    { brand: "Ryunix", supports: (device) => KyuProMx1Client.isSupported(device), create: (device) => new KyuProMx1Client(device), score: () => 7 },
    // Rapoo owns vendor id 0x24AE and the 0xFF00:0x000E configuration
    // collection, neither of which another driver claims, so the two product ids
    // can be the whole matcher.
    { brand: "Rapoo", supports: (device) => RapooHidClient.isSupported(device), create: (device) => new RapooHidClient(device), score: () => 7 },
    { brand: "Cooler Master", supports: (device) => CoolerMasterHidClient.isSupported(device), create: (device) => new CoolerMasterHidClient(device), score: () => 7 },
    { brand: "AJAZZ", supports: (device) => AjazzAk820HidClient.isSupported(device), create: (device) => new AjazzAk820HidClient(device), score: () => 7 },
    // Hitscan owns vendor id 0x3770, which no other driver claims.
    { brand: "Hitscan", supports: (device) => HitscanHidClient.isSupported(device), create: (device) => new HitscanHidClient(device), score: () => 7 },
];
function driverFor(device) {
    return DEVICE_DRIVERS.find((driver) => driver.supports(device));
}
export function createSupportedClient(device) {
    return driverFor(device)?.create(device) ?? null;
}
export function clientSupportScore(device) {
    return driverFor(device)?.score(device) ?? 0;
}
export function deviceBrand(client) {
    if (client instanceof EggOp1HidClient || client instanceof EggOtHidClient || isEggWeClient(client))
        return "Endgame Gear";
    if (client instanceof LamzuHidClient)
        return client.deviceBrand();
    if (client instanceof AtkHidClient)
        return client.deviceBrand();
    if (client instanceof DeluxHidClient)
        return client.deviceBrand();
    if (client instanceof AttackSharkHidClient)
        return client.deviceBrand();
    if (client instanceof KsnakeHidClient && isNoirM2NexDevice(client.device))
        return "Noir Gear";
    return driverFor(client.device)?.brand ?? "Unknown";
}
