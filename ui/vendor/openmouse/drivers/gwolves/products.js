export const GWOLVES_VENDOR_ID = 0x33e4;
export const GWOLVES_PRODUCTS = new Map([
    [0x5618, { model: "HTX Ultra", wireless: false, verified: true, protocol: "gwolves" }],
    [0x3854, { model: "HTX Ultra", wireless: true, verified: true, protocol: "gwolves" }],
    // Read from mouse.fit (env-models.json, XVI 0, ButtonType 1, MID 11). Not tried on hardware.
    [0x5219, { model: "HTS Plus Pro", wireless: false, verified: false, protocol: "gwolves", magnetic: true }],
    // Everything below is transcribed from G-Wolves' own live web-driver config
    // (https://mouse.xyz/Config/env-models.json, AppVer 1.0.0.50), not
    // independently hardware-tested. The "XVI": "0" generation shares one
    // wireless receiver (0x3854) across every model; the wired PID identifies
    // the mouse behind it (MID 02-17), so only wired PIDs are listed here —
    // wireless goes through the already-verified 0x3854 entry, with the MID
    // resolved live (see GWolvesHidClient.isMagnetic for the MID-11 pattern).
    // All of these report IsNewProtocol 1 and DPI max 32K (MID 02/04/05) or 40K
    // with a 5-step lift-off (MID 06+); the driver currently caps DPI options at
    // 26K until a unit is captured/verified, same as the HTX Ultra entry above.
    [0x5418, { model: "HTS Plus", wireless: false, verified: false, protocol: "gwolves" }],
    [0x4718, { model: "Lycan", wireless: false, verified: false, protocol: "gwolves" }],
    [0x4719, { model: "Lycan", wireless: false, verified: false, protocol: "gwolves" }],
    [0x5619, { model: "HTX Ultra", wireless: false, verified: false, protocol: "gwolves" }],
    [0x5419, { model: "HTS Plus", wireless: false, verified: false, protocol: "gwolves" }],
    [0x3619, { model: "Fenrir Pro", wireless: false, verified: false, protocol: "gwolves" }],
    [0x2719, { model: "HTX Mini", wireless: false, verified: false, protocol: "gwolves" }],
    [0x4219, { model: "WARG", wireless: false, verified: false, protocol: "gwolves" }],
    [0x2619, { model: "HTX Mini Asym", wireless: false, verified: false, protocol: "gwolves" }],
    [0x3519, { model: "Fenrir Asym", wireless: false, verified: false, protocol: "gwolves" }],
    // Everything below is transcribed from G-Wolves' own live web-driver config
    // (https://mouse.xyz/Config/env-models.json), not independently
    // hardware-tested. Re-checked 2026-09-26: only the HTX Ultra generation
    // (wireless 0x3854) is XVI 0; every entry below is XVI 1, and all but the
    // "xvi-new" ones have "IsNewProtocol": "0". Add further G-Wolves models here
    // as they're captured/verified, but confirm with a real capture before
    // setting verified: true, since a wrong address/encoding on an unverified
    // model could silently write the wrong value rather than fail loudly.
    [0x3808, { model: "HTM Plus", wireless: false, verified: false, protocol: "xvi-new" }],
    [0x3817, { model: "HTM Plus", wireless: true, verified: false, protocol: "xvi-new" }],
    [0x6808, { model: "HSK Pro 2.0", wireless: false, verified: false, protocol: "xvi-new" }],
    [0x6817, { model: "HSK Pro 2.0", wireless: true, verified: false, protocol: "xvi-new" }],
    [0x5608, { model: "HTXU", wireless: false, verified: false, protocol: "xvi-new" }],
    [0x5617, { model: "HTXU", wireless: true, verified: false, protocol: "xvi-new" }],
    [0x3608, { model: "Fenrir Pro", wireless: false, verified: false, protocol: "xvi-new" }],
    [0x3617, { model: "Fenrir Pro", wireless: true, verified: false, protocol: "xvi-new" }],
    [0x3908, { model: "VUK", wireless: false, verified: false, protocol: "xvi" }],
    [0x3917, { model: "VUK", wireless: true, verified: false, protocol: "xvi" }],
    [0x7904, { model: "HT-S2", wireless: false, verified: false, protocol: "xvi" }],
    [0x7913, { model: "HT-S2", wireless: true, verified: false, protocol: "xvi" }],
    [0x3708, { model: "Fenir Max", wireless: false, verified: false, protocol: "xvi" }],
    [0x3717, { model: "Fenir Max", wireless: true, verified: false, protocol: "xvi" }],
    [0x5308, { model: "HTS Ultra", wireless: false, verified: false, protocol: "xvi" }],
    [0x5317, { model: "HTS Ultra", wireless: true, verified: false, protocol: "xvi" }],
    [0x7704, { model: "HTR", wireless: false, verified: false, protocol: "xvi" }],
    [0x7713, { model: "HTR", wireless: true, verified: false, protocol: "xvi" }],
    [0x3508, { model: "Fenrir", wireless: false, verified: false, protocol: "xvi" }],
    [0x3517, { model: "Fenrir", wireless: true, verified: false, protocol: "xvi" }],
    [0x7908, { model: "HT-S2 Pro", wireless: false, verified: false, protocol: "xvi" }],
    [0x7917, { model: "HT-S2 Pro", wireless: true, verified: false, protocol: "xvi" }],
    [0x5808, { model: "HSK Pro", wireless: false, verified: false, protocol: "xvi" }],
    [0x5817, { model: "HSK Pro", wireless: true, verified: false, protocol: "xvi" }],
    [0x2708, { model: "HTX Mini", wireless: false, verified: false, protocol: "xvi" }],
    // DPI, polling and lift-off confirmed on this receiver (ticket #0105).
    [0x2717, { model: "HTX Mini", wireless: true, verified: true, protocol: "xvi" }],
    // HSK Lite, from the same live config. Its wireless PID ends in 0x03 like
    // the ACE models' 1K receivers, so it is treated as 1K-max (see
    // supportedPollingRates in xvi-hid.ts) until hardware says otherwise.
    [0x7204, { model: "HSK Lite", wireless: false, verified: false, protocol: "xvi" }],
    [0x7203, { model: "HSK Lite", wireless: true, verified: false, protocol: "xvi" }],
    // 4K dongles for the models that also ship one (the _4KDongle entries in
    // that config). All end in 0x07, which xvi-hid.ts caps at 4K polling.
    [0x5807, { model: "HSK Pro", wireless: true, verified: false, protocol: "xvi" }],
    [0x5407, { model: "HTS Plus", wireless: true, verified: false, protocol: "xvi" }],
    [0x5707, { model: "HTX", wireless: true, verified: false, protocol: "xvi" }],
    [0x5907, { model: "HSK Plus", wireless: true, verified: false, protocol: "xvi" }],
    [0x5408, { model: "HTS Plus", wireless: false, verified: false, protocol: "xvi" }],
    [0x5417, { model: "HTS Plus", wireless: true, verified: false, protocol: "xvi" }],
    [0x5708, { model: "HTX", wireless: false, verified: false, protocol: "xvi" }],
    [0x5717, { model: "HTX", wireless: true, verified: false, protocol: "xvi" }],
    [0x5908, { model: "HSK Plus", wireless: false, verified: false, protocol: "xvi" }],
    [0x5917, { model: "HSK Plus", wireless: true, verified: false, protocol: "xvi" }],
    [0x7708, { model: "HTR Pro", wireless: false, verified: false, protocol: "xvi" }],
    [0x7717, { model: "HTR Pro", wireless: true, verified: false, protocol: "xvi" }],
    [0x5804, { model: "HSK Pro ACE", wireless: false, verified: false, protocol: "xvi" }],
    [0x5803, { model: "HSK Pro ACE", wireless: true, verified: false, protocol: "xvi" }],
    [0x5404, { model: "HTS Plus ACE", wireless: false, verified: false, protocol: "xvi" }],
    [0x5403, { model: "HTS Plus ACE", wireless: true, verified: false, protocol: "xvi" }],
    [0x5704, { model: "HTX ACE", wireless: false, verified: false, protocol: "xvi" }],
    [0x5703, { model: "HTX ACE", wireless: true, verified: false, protocol: "xvi" }],
    [0x5904, { model: "HSK Plus ACE", wireless: false, verified: false, protocol: "xvi" }],
    [0x5903, { model: "HSK Plus ACE", wireless: true, verified: false, protocol: "xvi" }],
    // "TEST HTS Plus" in that config (wired 0x5428, wireless 0x3854) is
    // deliberately skipped: its own name marks it a dev/test entry, and its
    // wireless id collides with the already-verified HTX Ultra's 0x3854.
]);
