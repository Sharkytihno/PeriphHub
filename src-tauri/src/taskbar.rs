// Batteries dans la barre des tâches : « 🖱 93 %  🎧 30 % » juste à gauche de la zone de notification.
//
// Technique reprise de WirelessBattery (krisgfx9/Wireless-Device-Battery-Monitor, GPL-3.0,
// src/widget.cpp), réécrite en Rust : une petite fenêtre transparente (« layered ») enfant de la
// barre des tâches (Shell_TrayWnd), dessinée en mémoire puis posée par UpdateLayeredWindow, et
// replacée chaque seconde contre la zone de notification (TrayNotifyWnd).
//
// Règles qui évitent de bloquer l'Explorateur (sa barre des tâches attend notre fil dès qu'elle se
// redessine, puisque notre fenêtre est sa fille) :
// - un fil dédié possède la fenêtre et ne fait jamais rien de bloquant (ni appel à Tauri, ni attente) :
//   ouvrir PeriphHub, actualiser… passent par run_on_main_thread, qui ne fait que poster ;
// - le bouton Widgets de Windows 11 (XAML, connu seulement d'UI Automation) est cherché depuis un
//   AUTRE fil, sans fenêtre : depuis le fil de la fenêtre, l'Explorateur et nous nous attendrions
//   mutuellement (WirelessBattery l'a vu : Explorateur « ne répond pas » puis relancé en boucle).
//
// Barre des tâches verticale ou introuvable, ou choix de l'utilisateur : une icône de notification par
// appareil, avec le pourcentage dessiné dedans (créées sur le fil principal, API de Tauri).

use serde::Deserialize;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::*;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

// ---------- Réglages venus de l'interface ----------

#[derive(Deserialize, Clone, PartialEq, Default)]
pub struct Item {
    pub key: String,
    pub name: String,
    /// souris, casque, clavier, manette, téléphone, bluetooth, autre
    #[serde(default)]
    pub kind: String,
    /// -1 : inconnu
    pub level: i32,
    #[serde(default)]
    pub charging: bool,
    /// Appareil en veille : dernière valeur connue, grisée
    #[serde(default)]
    pub dim: bool,
    /// Texte à la place du pourcentage (niveaux approximatifs : « Faible »…)
    #[serde(default)]
    pub text: Option<String>,
    /// Mesure du PC (processeur…) : court libellé dessiné à la place de l'icône (« CPU »)
    #[serde(default)]
    pub tag: Option<String>,
}

/// Mesure du PC demandée par l'interface : key = cpu, gpu ou ram
#[derive(Deserialize, Clone, PartialEq, Default)]
pub struct Stat {
    pub key: String,
    /// Libellé court dans la barre (« CPU »)
    pub label: String,
    /// Nom dans l'infobulle (« Processeur »)
    pub name: String,
}

#[derive(Deserialize, Clone, PartialEq, Default)]
pub struct Cfg {
    /// "taskbar" (barre des tâches), "tray" (icônes de notification), "off"
    pub mode: String,
    /// Fond derrière le texte (barres des tâches transparentes : Windhawk, TranslucentTB…)
    #[serde(default)]
    pub plate: bool,
    pub items: Vec<Item>,
    /// Infobulle du widget (une ligne par appareil)
    #[serde(default)]
    pub tip: String,
    /// Menu du clic droit, dans la langue de l'interface : Ouvrir / Actualiser / Ne plus afficher
    #[serde(default)]
    pub menu: Vec<String>,
    /// Mesures du PC à afficher avant les batteries, dans cet ordre
    #[serde(default)]
    pub stats: Vec<Stat>,
}

static CFG: Mutex<Option<Cfg>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();
static THREAD: AtomicU32 = AtomicU32::new(0);
static STARTED: AtomicBool = AtomicBool::new(false);
/// Le widget n'a pas pu se poser (barre verticale, Explorateur absent) : icônes de notification
static FALLBACK: AtomicBool = AtomicBool::new(false);
/// Ce qui est affiché, pour les réglages : "taskbar", "tray", "off", "vertical", "none"
static SHOWN: Mutex<&'static str> = Mutex::new("off");

fn cfg() -> Cfg {
    CFG.lock().map(|c| c.clone().unwrap_or_default()).unwrap_or_default()
}

fn wake() {
    let t = THREAD.load(Ordering::Relaxed);
    if t != 0 {
        unsafe { PostThreadMessageW(t, WM_APP, 0, 0) };
    }
}

/// Appelé par l'interface à chaque changement des batteries ou des réglages (fil principal)
#[tauri::command]
pub fn taskbar_set(app: AppHandle, cfg: Cfg) -> Value {
    let _ = APP.set(app.clone());
    let changed = CFG.lock().map(|mut c| {
        let ch = c.as_ref() != Some(&cfg);
        *c = Some(cfg);
        ch
    });
    if !STARTED.swap(true, Ordering::Relaxed) {
        std::thread::Builder::new().name("barre-des-taches".into()).spawn(widget_thread).ok();
        std::thread::Builder::new().name("bouton-widgets".into()).spawn(widgets_button_thread).ok();
        std::thread::Builder::new().name("mesures-du-pc".into()).spawn(|| crate::usage::run(stats_wanted, stats_changed)).ok();
    }
    if changed.unwrap_or(true) {
        wake();
        apply_tray(&app);
    }
    taskbar_state()
}

#[tauri::command]
pub fn taskbar_state() -> Value {
    json!({ "shown": *SHOWN.lock().unwrap_or_else(|e| e.into_inner()) })
}

/// Mesures demandées : (processeur, carte graphique, mémoire), rien quand l'affichage est coupé
fn stats_wanted() -> (bool, bool, bool) {
    let c = cfg();
    let on = |k: &str| c.mode != "off" && c.stats.iter().any(|s| s.key == k);
    (on("cpu"), on("gpu"), on("ram"))
}

/// Nouvelles valeurs (fil des mesures) : redessiner le widget ou les icônes de notification
fn stats_changed() {
    wake();
    let c = cfg();
    if c.mode == "tray" || (c.mode == "taskbar" && FALLBACK.load(Ordering::Relaxed)) {
        post_main(apply_tray);
    }
}

fn is_stat(kind: &str) -> bool {
    matches!(kind, "cpu" | "gpu" | "ram")
}

/// Mesures du PC puis batteries, dans l'ordre d'affichage
fn all_items(c: &Cfg) -> Vec<Item> {
    let u = crate::usage::last();
    let mut out: Vec<Item> = c
        .stats
        .iter()
        .filter(|s| is_stat(&s.key))
        .map(|s| Item {
            key: format!("stat-{}", s.key),
            name: s.name.clone(),
            kind: s.key.clone(),
            level: match s.key.as_str() {
                "cpu" => u.cpu,
                "gpu" => u.gpu,
                _ => u.ram,
            },
            tag: Some(s.label.clone()),
            ..Item::default()
        })
        .collect();
    out.extend(c.items.iter().cloned());
    out
}

fn set_shown(s: &'static str) {
    if let Ok(mut g) = SHOWN.lock() {
        *g = s;
    }
}

// ---------- Couleurs, thème, police ----------

#[derive(Clone, Copy)]
struct Rgb(u8, u8, u8);

/// Thème de la barre des tâches (SystemUsesLightTheme : celui de la barre, pas des applications)
fn light_taskbar() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|k| k.get_value::<u32, _>("SystemUsesLightTheme"))
        .map(|v| v != 0)
        .unwrap_or(false)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Police, avec repli quand la première n'est pas installée (GDI en substituerait une autre en silence)
unsafe fn make_font(px: i32, weight: i32, faces: &[&str]) -> HFONT {
    for (i, face) in faces.iter().enumerate() {
        let wf = wide(face);
        let h = CreateFontW(-px, 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET as u32, OUT_DEFAULT_PRECIS as u32, CLIP_DEFAULT_PRECIS as u32,
            ANTIALIASED_QUALITY as u32, DEFAULT_PITCH as u32, wf.as_ptr());
        if i + 1 == faces.len() {
            return h;
        }
        let dc = CreateCompatibleDC(null_mut());
        let old = SelectObject(dc, h as HGDIOBJ);
        let mut got = [0u16; 32];
        let n = GetTextFaceW(dc, got.len() as i32, got.as_mut_ptr());
        SelectObject(dc, old);
        DeleteDC(dc);
        let got = String::from_utf16_lossy(&got[..n.max(1) as usize - 1]);
        if got.eq_ignore_ascii_case(face) {
            return h;
        }
        DeleteObject(h as HGDIOBJ);
    }
    null_mut()
}

/// Masque de couverture (niveaux de gris) d'un texte, recadré sur son encre
#[derive(Default)]
struct Mask {
    w: i32,
    h: i32,
    a: Vec<u8>,
}

unsafe fn render_mask(s: &str, font: HFONT, extra: i32) -> Mask {
    let t: Vec<u16> = s.encode_utf16().collect();
    let dc = CreateCompatibleDC(null_mut());
    let of = SelectObject(dc, font as HGDIOBJ);
    SetTextCharacterExtra(dc, extra);
    let mut sz = SIZE { cx: 0, cy: 0 };
    GetTextExtentPoint32W(dc, t.as_ptr(), t.len() as i32, &mut sz);
    let (w, h) = (sz.cx + 8, sz.cy + 8);
    let mut bi: BITMAPINFO = std::mem::zeroed();
    bi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..std::mem::zeroed()
    };
    let mut bits: *mut core::ffi::c_void = null_mut();
    let bmp = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
    let mut m = Mask::default();
    if !bmp.is_null() && !bits.is_null() {
        let ob = SelectObject(dc, bmp as HGDIOBJ);
        let px = std::slice::from_raw_parts_mut(bits as *mut u32, (w * h) as usize);
        px.fill(0);
        SetBkMode(dc, TRANSPARENT as i32);
        SetTextColor(dc, 0x00FF_FFFF);
        TextOutW(dc, 4, 4, t.as_ptr(), t.len() as i32);
        GdiFlush();
        let (mut x0, mut y0, mut x1, mut y1) = (w, h, -1, -1);
        for y in 0..h {
            for x in 0..w {
                if px[(y * w + x) as usize] & 0xFF != 0 {
                    x0 = x0.min(x);
                    x1 = x1.max(x);
                    y0 = y0.min(y);
                    y1 = y1.max(y);
                }
            }
        }
        if x1 >= 0 {
            m.w = x1 - x0 + 1;
            m.h = y1 - y0 + 1;
            m.a = Vec::with_capacity((m.w * m.h) as usize);
            for y in 0..m.h {
                for x in 0..m.w {
                    m.a.push((px[((y0 + y) * w + x0 + x) as usize] & 0xFF) as u8);
                }
            }
        }
        SelectObject(dc, ob);
        DeleteObject(bmp as HGDIOBJ);
    }
    SelectObject(dc, of);
    DeleteDC(dc);
    m
}

/// Toile BGRA prémultipliée (format attendu par UpdateLayeredWindow)
struct Canvas {
    w: i32,
    h: i32,
    px: Vec<u32>,
}

impl Canvas {
    fn blend(&mut self, x: i32, y: i32, c: Rgb, a: i32) {
        if x < 0 || y < 0 || x >= self.w || y >= self.h || a <= 0 {
            return;
        }
        let d = self.px[(y * self.w + x) as usize];
        let inv = 255 - a;
        let (da, dr, dg, db) = ((d >> 24) as i32, ((d >> 16) & 255) as i32, ((d >> 8) & 255) as i32, (d & 255) as i32);
        let oa = a + da * inv / 255;
        let or = c.0 as i32 * a / 255 + dr * inv / 255;
        let og = c.1 as i32 * a / 255 + dg * inv / 255;
        let ob = c.2 as i32 * a / 255 + db * inv / 255;
        self.px[(y * self.w + x) as usize] = ((oa as u32) << 24) | ((or as u32) << 16) | ((og as u32) << 8) | ob as u32;
    }
    fn draw(&mut self, m: &Mask, x: i32, y: i32, c: Rgb, alpha: i32) {
        for j in 0..m.h {
            for i in 0..m.w {
                self.blend(x + i, y + j, c, m.a[(j * m.w + i) as usize] as i32 * alpha / 255);
            }
        }
    }
    fn round_rect(&mut self, inset: i32, r: i32, c: Rgb, a: i32) {
        let (w, h) = (self.w, self.h);
        for y in inset..h - inset {
            for x in 0..w {
                let dx = if x < r { r - x } else if x >= w - r { x - (w - r - 1) } else { 0 };
                let dy = if y < inset + r { inset + r - y } else if y >= h - inset - r { y - (h - inset - r - 1) } else { 0 };
                if dx * dx + dy * dy <= r * r {
                    self.blend(x, y, c, a);
                }
            }
        }
    }
}

/// Icône Segoe Fluent Icons / MDL2 Assets de chaque type d'appareil
fn glyph(kind: &str) -> char {
    match kind {
        "casque" => '\u{E7F6}',
        "souris" => '\u{E962}',
        "clavier" => '\u{E765}',
        "manette" => '\u{E7FC}',
        "téléphone" => '\u{E8EA}',
        "bluetooth" => '\u{E702}',
        _ => '\u{E772}',
    }
}
const BOLT: char = '\u{E945}';
const BATTERY_UNKNOWN: char = '\u{E996}';

fn level_text(it: &Item) -> String {
    match &it.text {
        Some(t) if !t.is_empty() => t.clone(),
        _ if it.level >= 0 => format!("{}\u{202F}%", it.level),
        _ => "?".into(),
    }
}

fn is_low(it: &Item) -> bool {
    !it.charging && it.level >= 0 && it.level <= 15
}

/// En rouge : batterie faible, ou mesure du PC à 90 % ou plus
fn alert(it: &Item) -> bool {
    if is_stat(&it.kind) { it.level >= 90 } else { is_low(it) }
}

fn palette(light: bool) -> (Rgb, Rgb, Rgb) {
    if light {
        (Rgb(0, 0, 0), Rgb(196, 30, 40), Rgb(0, 120, 212))
    } else {
        (Rgb(255, 255, 255), Rgb(255, 90, 90), Rgb(96, 205, 255))
    }
}

// ---------- Widget (fil dédié) ----------

struct Widget {
    wnd: HWND,
    bar: HWND,
    rebar: HWND,
    tip: HWND,
    size: (i32, i32),
    last: Option<(RECT, RECT, RECT, i32)>,
    dpi: u32,
    sig: String,
    tip_text: Vec<u16>,
}

impl Default for Widget {
    fn default() -> Self {
        Widget { wnd: null_mut(), bar: null_mut(), rebar: null_mut(), tip: null_mut(), size: (0, 0), last: None, dpi: 0, sig: String::new(), tip_text: vec![0] }
    }
}

thread_local! {
    static W: RefCell<Widget> = RefCell::new(Widget::default());
    static HOST: Cell<HWND> = const { Cell::new(null_mut()) };
    static HOVER: Cell<bool> = const { Cell::new(false) };
    static LIGHT: Cell<bool> = const { Cell::new(false) };
}

/// Barre des tâches visée par le fil du bouton Widgets (0 : aucune) et dernier rectangle trouvé
static WB_BAR: AtomicIsize = AtomicIsize::new(0);
static WB_RECT: Mutex<(isize, RECT)> = Mutex::new((0, RECT { left: 0, top: 0, right: 0, bottom: 0 }));

const WIDGET_CLASS: &str = "PeriphHubBatteryWidget";
const HOST_CLASS: &str = "PeriphHubBatteryHost";
const ID_OPEN: usize = 1;
const ID_REFRESH: usize = 2;
const ID_HIDE: usize = 3;

fn widget_thread() {
    unsafe {
        THREAD.store(windows_sys::Win32::System::Threading::GetCurrentThreadId(), Ordering::Relaxed);
        let inst = GetModuleHandleW(null());
        for (name, proc_) in [(WIDGET_CLASS, widget_proc as unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT), (HOST_CLASS, host_proc)] {
            let cls = wide(name);
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(proc_),
                hInstance: inst,
                hCursor: LoadCursorW(null_mut(), IDC_ARROW),
                lpszClassName: cls.as_ptr(),
                ..std::mem::zeroed()
            };
            RegisterClassExW(&wc);
        }
        // Fenêtre cachée de premier niveau (pas « message-only ») : propriétaire de l'infobulle et du
        // menu, et destinataire des changements de thème diffusés à toutes les fenêtres
        let hc = wide(HOST_CLASS);
        let host = CreateWindowExW(WS_EX_TOOLWINDOW, hc.as_ptr(), null(), WS_POPUP, 0, 0, 0, 0, null_mut(), null_mut(), inst, null());
        HOST.with(|h| h.set(host));
        LIGHT.with(|l| l.set(light_taskbar()));
        let icc = INITCOMMONCONTROLSEX { dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32, dwICC: ICC_WIN95_CLASSES };
        InitCommonControlsEx(&icc);
        let mut msg: MSG = std::mem::zeroed();
        loop {
            MsgWaitForMultipleObjects(0, null(), 0, 1000, QS_ALLINPUT);
            while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    return;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            // Une erreur interne ici ne doit ni fermer PeriphHub ni laisser la barre dans un état bizarre
            if std::panic::catch_unwind(tick).is_err() {
                W.with(|w| destroy(&mut w.borrow_mut()));
            }
        }
    }
}

fn tick() {
    let c = cfg();
    W.with(|w| {
        let mut w = w.borrow_mut();
        let w = &mut *w;
        if c.mode != "taskbar" {
            destroy(w);
            set_fallback(false);
            set_shown(if c.mode == "tray" { "tray" } else { "off" });
            return;
        }
        if !alive(w) {
            destroy(w);
            match unsafe { create(w) } {
                Ok(()) => set_fallback(false),
                Err(why) => {
                    set_fallback(true);
                    set_shown(why);
                    return;
                }
            }
        }
        set_shown("taskbar");
        unsafe {
            paint(w, &c);
            reposition(w);
        }
    });
}

fn set_fallback(on: bool) {
    if FALLBACK.swap(on, Ordering::Relaxed) != on {
        if let Some(app) = APP.get() {
            let a = app.clone();
            let _ = app.run_on_main_thread(move || apply_tray(&a));
        }
    }
}

fn alive(w: &Widget) -> bool {
    unsafe { !w.wnd.is_null() && IsWindow(w.wnd) != 0 && !w.bar.is_null() && IsWindow(w.bar) != 0 }
}

fn dpi(w: &Widget) -> i32 {
    let d = if w.bar.is_null() { 0 } else { unsafe { GetDpiForWindow(w.bar) } };
    if d == 0 { 96 } else { d as i32 }
}

fn px(w: &Widget, v: i32) -> i32 {
    v * dpi(w) / 96
}

unsafe fn find(parent: HWND, class: &str) -> HWND {
    let c = wide(class);
    FindWindowExW(parent, null_mut(), c.as_ptr(), null())
}

unsafe fn create(w: &mut Widget) -> Result<(), &'static str> {
    let tc = wide("Shell_TrayWnd");
    let bar = FindWindowW(tc.as_ptr(), null());
    if bar.is_null() || find(bar, "TrayNotifyWnd").is_null() {
        return Err("none");
    }
    let mut tb: RECT = std::mem::zeroed();
    GetWindowRect(bar, &mut tb);
    if tb.bottom - tb.top > tb.right - tb.left {
        return Err("vertical");
    }
    // Windows 11 : barre en XAML ; Windows 10 : les boutons des applications sont dans ReBarWindow32
    // et doivent être rétrécis pour ne jamais passer sous le widget
    w.rebar = if find(bar, "Windows.UI.Composition.DesktopWindowContentBridge").is_null() { find(bar, "ReBarWindow32") } else { null_mut() };
    let inst = GetModuleHandleW(null());
    let wc = wide(WIDGET_CLASS);
    let wnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_NOACTIVATE, wc.as_ptr(), null(), WS_CHILD | WS_CLIPSIBLINGS, 0, 0, 1, 1, bar, null_mut(), inst, null());
    if wnd.is_null() {
        return Err("none");
    }
    w.bar = bar;
    w.wnd = wnd;
    w.sig.clear();
    w.last = None;
    let host = HOST.with(|h| h.get());
    let tip = CreateWindowExW(WS_EX_TOPMOST, TOOLTIPS_CLASSW, null(), WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX, 0, 0, 0, 0, host, null_mut(), inst, null());
    if !tip.is_null() {
        w.tip = tip;
        tip_theme(w);
        let mut ti = tool(w);
        SendMessageW(tip, TTM_ADDTOOLW, 0, &mut ti as *mut _ as LPARAM);
        SendMessageW(tip, TTM_SETMAXTIPWIDTH, 0, 600);
    }
    WB_BAR.store(bar as isize, Ordering::Relaxed);
    w.dpi = dpi(w) as u32;
    ShowWindow(wnd, SW_SHOWNOACTIVATE);
    Ok(())
}

unsafe fn tool(w: &mut Widget) -> TTTOOLINFOW {
    let mut ti: TTTOOLINFOW = std::mem::zeroed();
    ti.cbSize = std::mem::size_of::<TTTOOLINFOW>() as u32;
    ti.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    ti.hwnd = HOST.with(|h| h.get());
    ti.uId = w.wnd as usize;
    ti.lpszText = w.tip_text.as_mut_ptr();
    ti
}

unsafe fn tip_theme(w: &Widget) {
    if w.tip.is_null() {
        return;
    }
    let theme = wide(if LIGHT.with(|l| l.get()) { "Explorer" } else { "DarkMode_Explorer" });
    SetWindowTheme(w.tip, theme.as_ptr(), null());
    SendMessageW(w.tip, WM_THEMECHANGED, 0, 0);
}

fn destroy(w: &mut Widget) {
    unsafe {
        if !w.rebar.is_null() && IsWindow(w.rebar) != 0 && !w.bar.is_null() && IsWindow(w.bar) != 0 {
            // L'Explorateur réétale les boutons des applications sur toute la largeur
            let mut r: RECT = std::mem::zeroed();
            GetClientRect(w.bar, &mut r);
            PostMessageW(w.bar, WM_SIZE, SIZE_RESTORED as WPARAM, ((r.bottom as u32) << 16 | (r.right as u32 & 0xFFFF)) as LPARAM);
        }
        if !w.tip.is_null() {
            DestroyWindow(w.tip);
        }
        if !w.wnd.is_null() && IsWindow(w.wnd) != 0 {
            DestroyWindow(w.wnd);
        }
    }
    WB_BAR.store(0, Ordering::Relaxed);
    *w = Widget::default();
    HOVER.with(|h| h.set(false));
}

/// Dessin du widget en mémoire (sans fenêtre : testable) ; d = points par pouce de la barre
unsafe fn compose(items: &[Item], h: i32, d: i32, light: bool, hover: bool, plate: bool) -> Canvas {
    let px = |v: i32| v * d / 96;
    let (fg, red, blue) = palette(light);
    let icons = make_font(px(16), FW_NORMAL as i32, &["Segoe Fluent Icons", "Segoe MDL2 Assets"]);
    let boltf = make_font(px(11), FW_NORMAL as i32, &["Segoe Fluent Icons", "Segoe MDL2 Assets"]);
    let text = make_font(px(13), FW_NORMAL as i32, &["Segoe UI Variable Text", "Segoe UI"]);
    let tagf = make_font(px(11), FW_SEMIBOLD as i32, &["Segoe UI Variable Text", "Segoe UI"]);
    // Morceaux : icône (ou libellé « CPU »), niveau, éclair (en charge), espace avant le suivant
    let mut pieces: Vec<(Mask, Rgb, i32, i32)> = Vec::new();
    let stat_w = if items.iter().any(|i| is_stat(&i.kind)) { render_mask("88\u{202F}%", text, 0).w } else { 0 };
    if items.is_empty() {
        pieces.push((render_mask(&BATTERY_UNKNOWN.to_string(), icons, 0), fg, 110, 0));
    }
    for (i, it) in items.iter().enumerate() {
        let a = if it.dim { 120 } else { 255 };
        match &it.tag {
            Some(t) => pieces.push((render_mask(t, tagf, 0), fg, 165, px(4))),
            None => pieces.push((render_mask(&glyph(&it.kind).to_string(), icons, 0), fg, a, px(5))),
        }
        let lv = render_mask(&level_text(it), text, 0);
        // Mesure du PC : largeur réservée pour deux chiffres, sinon le widget bougerait toutes les 2 s
        let pad = if is_stat(&it.kind) { (stat_w - lv.w).max(0) } else { 0 };
        pieces.push((lv, if alert(it) { red } else { fg }, a, pad + if it.charging { px(2) } else { 0 }));
        if it.charging {
            pieces.push((render_mask(&BOLT.to_string(), boltf, 0), blue, a, 0));
        }
        if let Some(p) = pieces.last_mut() {
            p.3 += if i + 1 < items.len() { px(14) } else { 0 };
        }
    }
    for f in [icons, boltf, text, tagf] {
        DeleteObject(f as HGDIOBJ);
    }
    let width = px(8) * 2 + pieces.iter().map(|p| p.0.w + p.3).sum::<i32>();
    let mut cv = Canvas { w: width, h, px: vec![0x0100_0000; (width * h) as usize] }; // presque transparent : reçoit la souris
    if plate {
        cv.round_rect(px(4), px(6), if light { Rgb(243, 243, 243) } else { Rgb(32, 32, 32) }, 240);
    }
    if hover {
        cv.round_rect(px(4), px(4), if light { Rgb(0, 0, 0) } else { Rgb(255, 255, 255) }, if light { 20 } else { 26 });
    }
    let mut x = px(8);
    for (m, col, a, gap) in &pieces {
        cv.draw(m, x, (h - m.h) / 2, *col, *a);
        x += m.w + gap;
    }
    cv
}

unsafe fn paint(w: &mut Widget, c: &Cfg) {
    let light = LIGHT.with(|l| l.get());
    let hover = HOVER.with(|h| h.get());
    let mut bar: RECT = std::mem::zeroed();
    GetClientRect(w.bar, &mut bar);
    let h = bar.bottom - bar.top;
    let d = dpi(w);
    let items = all_items(c);
    // Infobulle : mesures du PC puis batteries
    if !w.tip.is_null() {
        let mut tip: Vec<String> = items.iter().filter(|i| is_stat(&i.kind)).map(|i| format!("{} : {}", i.name, level_text(i))).collect();
        if !c.items.is_empty() || tip.is_empty() {
            tip.push(if c.tip.is_empty() { "PeriphHub".into() } else { c.tip.clone() });
        }
        let t = wide(&tip.join("\n"));
        if t != w.tip_text {
            w.tip_text = t;
            let mut ti = tool(w);
            SendMessageW(w.tip, TTM_UPDATETIPTEXTW, 0, &mut ti as *mut _ as LPARAM);
        }
    }
    let sig = format!("{h}|{d}|{light}|{hover}|{}|{}", c.plate,
        items.iter().map(|i| format!("{}:{}:{}:{}:{}:{:?}:{:?}", i.kind, i.level, i.charging, i.dim, alert(i), i.text, i.tag)).collect::<Vec<_>>().join(","));
    if sig == w.sig || h <= 0 {
        return;
    }
    w.sig = sig;
    let cv = compose(&items, h, d, light, hover, c.plate);
    let width = cv.w;
    let screen = GetDC(null_mut());
    let mem = CreateCompatibleDC(screen);
    let mut bi: BITMAPINFO = std::mem::zeroed();
    bi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -h,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..std::mem::zeroed()
    };
    let mut bits: *mut core::ffi::c_void = null_mut();
    let bmp = CreateDIBSection(mem, &bi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
    if !bmp.is_null() && !bits.is_null() {
        std::ptr::copy_nonoverlapping(cv.px.as_ptr(), bits as *mut u32, cv.px.len());
        let ob = SelectObject(mem, bmp as HGDIOBJ);
        let sz = SIZE { cx: width, cy: h };
        let src = POINT { x: 0, y: 0 };
        let bf = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
        UpdateLayeredWindow(w.wnd, screen, null(), &sz, mem, &src, 0, &bf, ULW_ALPHA);
        SelectObject(mem, ob);
        DeleteObject(bmp as HGDIOBJ);
        w.size = (width, h);
        w.last = None; // nouvelle taille : replacer
    }
    DeleteDC(mem);
    ReleaseDC(null_mut(), screen);
}

unsafe fn reposition(w: &mut Widget) {
    let tray = find(w.bar, "TrayNotifyWnd");
    if tray.is_null() {
        return;
    }
    let (mut tr, mut bar): (RECT, RECT) = (std::mem::zeroed(), std::mem::zeroed());
    GetWindowRect(tray, &mut tr);
    GetWindowRect(w.bar, &mut bar);
    // Windows de droite à gauche (hébreu, arabe) : la barre est en miroir
    let rtl = GetWindowLongW(w.bar, GWL_EXSTYLE) as u32 & WS_EX_LAYOUTRTL != 0;
    let mut edge = if rtl { tr.right } else { tr.left };
    // Windows 10 : « Actualités et centres d'intérêt » juste à gauche de la zone de notification
    let feeds = find(w.bar, "ShellFeedsTaskbarViewWindow");
    if !rtl && !feeds.is_null() && IsWindowVisible(feeds) != 0 {
        let mut fr: RECT = std::mem::zeroed();
        GetWindowRect(feeds, &mut fr);
        if fr.left < edge && fr.right > fr.left {
            edge = fr.left;
        }
    }
    // Windows 11, barre alignée à gauche : le bouton Widgets (météo) se met là où on irait
    let wb = WB_RECT.lock().map(|g| if g.0 == w.bar as isize { g.1 } else { RECT { left: 0, top: 0, right: 0, bottom: 0 } })
        .unwrap_or(RECT { left: 0, top: 0, right: 0, bottom: 0 });
    let sw = w.size.0;
    if wb.right > wb.left && wb.top < bar.bottom && wb.bottom > bar.top
        && (if rtl { wb.left < edge + sw + px(w, 2) && wb.right > edge } else { wb.right > edge - sw - px(w, 2) && wb.left < edge })
    {
        edge = if rtl { wb.right } else { wb.left };
    }
    let mut p = POINT { x: edge, y: bar.top };
    ScreenToClient(w.bar, &mut p);
    let left = p.x - sw - px(w, 2);
    // Windows 10 : l'Explorateur réélargit les boutons des applications ; on les rétrécit de nouveau
    if !w.rebar.is_null() && IsWindow(w.rebar) != 0 {
        let mut rr: RECT = std::mem::zeroed();
        GetWindowRect(w.rebar, &mut rr);
        let mut tl = POINT { x: if rtl { rr.right } else { rr.left }, y: rr.top };
        ScreenToClient(w.bar, &mut tl);
        if tl.x + (rr.right - rr.left) > left && left > tl.x {
            MoveWindow(w.rebar, tl.x, tl.y, left - tl.x, rr.bottom - rr.top, 1);
        }
    }
    // Au-dessus du contenu de la barre (fenêtres sœurs), sans rien refaire si rien n'a bougé
    let covered = !GetWindow(w.wnd, GW_HWNDPREV).is_null();
    let key = (tr, bar, wb, left);
    let same = w.last.as_ref().is_some_and(|l| rect_eq(&l.0, &key.0) && rect_eq(&l.1, &key.1) && rect_eq(&l.2, &key.2) && l.3 == key.3);
    if !covered && same {
        return;
    }
    w.last = Some(key);
    SetWindowPos(w.wnd, HWND_TOP, left, 0, w.size.0, w.size.1, SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

fn rect_eq(a: &RECT, b: &RECT) -> bool {
    a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom
}

fn post_main(f: impl FnOnce(&AppHandle) + Send + 'static) {
    if let Some(app) = APP.get() {
        let a = app.clone();
        let _ = app.run_on_main_thread(move || f(&a));
    }
}

unsafe extern "system" fn widget_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_MOUSEMOVE => {
            if !HOVER.with(|v| v.replace(true)) {
                let mut t = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: h, dwHoverTime: 0 };
                TrackMouseEvent(&mut t);
                wake();
            }
            0
        }
        WM_MOUSELEAVE => {
            HOVER.with(|v| v.set(false));
            wake();
            0
        }
        WM_LBUTTONUP => {
            post_main(crate::background::show);
            0
        }
        WM_RBUTTONUP => {
            menu();
            0
        }
        WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
        _ => DefWindowProcW(h, msg, wp, lp),
    }
}

unsafe extern "system" fn host_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_SETTINGCHANGE || msg == WM_THEMECHANGED {
        let l = light_taskbar();
        if LIGHT.with(|v| v.replace(l)) != l {
            W.with(|w| {
                if let Ok(w) = w.try_borrow() {
                    tip_theme(&w);
                }
            });
            wake();
            post_main(apply_tray);
        }
    }
    DefWindowProcW(h, msg, wp, lp)
}

/// Clic droit : Ouvrir PeriphHub / Actualiser les batteries / Ne plus afficher dans la barre des tâches
unsafe fn menu() {
    let host = HOST.with(|h| h.get());
    let labels = cfg().menu;
    let label = |i: usize, d: &str| wide(labels.get(i).map(String::as_str).filter(|s| !s.is_empty()).unwrap_or(d));
    let m = CreatePopupMenu();
    if m.is_null() {
        return;
    }
    let (a, b, c) = (label(0, "Ouvrir PeriphHub"), label(1, "Actualiser les batteries"), label(2, "Ne plus afficher dans la barre des tâches"));
    AppendMenuW(m, MF_STRING, ID_OPEN, a.as_ptr());
    AppendMenuW(m, MF_STRING, ID_REFRESH, b.as_ptr());
    AppendMenuW(m, MF_SEPARATOR, 0, null());
    AppendMenuW(m, MF_STRING, ID_HIDE, c.as_ptr());
    let mut p = POINT { x: 0, y: 0 };
    GetCursorPos(&mut p);
    SetForegroundWindow(host);
    let cmd = TrackPopupMenu(m, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, p.x, p.y, 0, host, null()) as usize;
    PostMessageW(host, WM_NULL, 0, 0);
    DestroyMenu(m);
    match cmd {
        ID_OPEN => post_main(crate::background::show),
        ID_REFRESH => post_main(|a| {
            let _ = a.emit("battery-refresh", ());
        }),
        ID_HIDE => post_main(|a| {
            let _ = a.emit("taskbar-hide", ());
        }),
        _ => {}
    }
}

// ---------- Bouton Widgets de Windows 11 (UI Automation, fil sans fenêtre) ----------

fn widgets_button_thread() {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Descendants, UIA_AutomationIdPropertyId};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let mut uia: Option<IUIAutomation> = None;
    let mut btn: Option<IUIAutomationElement> = None;
    let mut btn_bar = 0isize;
    loop {
        let bar = WB_BAR.load(Ordering::Relaxed);
        if bar != btn_bar {
            btn = None;
            btn_bar = bar;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if bar != 0 && unsafe { IsWindow(bar as HWND) } != 0 {
            if uia.is_none() {
                uia = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok();
            }
            if let (Some(u), None) = (&uia, &btn) {
                btn = unsafe {
                    u.ElementFromHandle(windows::Win32::Foundation::HWND(bar as _)).ok().and_then(|root| {
                        let cond = u.CreatePropertyCondition(UIA_AutomationIdPropertyId, &VARIANT::from("WidgetsButton")).ok()?;
                        root.FindFirst(TreeScope_Descendants, &cond).ok()
                    })
                };
            }
            if let Some(b) = &btn {
                match unsafe { b.CurrentBoundingRectangle() } {
                    Ok(x) => r = RECT { left: x.left, top: x.top, right: x.right, bottom: x.bottom },
                    Err(_) => btn = None, // Widgets désactivés, Explorateur relancé : recherché de nouveau
                }
            }
        }
        if let Ok(mut g) = WB_RECT.lock() {
            if WB_BAR.load(Ordering::Relaxed) == bar {
                *g = (bar, r);
            }
        }
        // Rectangle relu toutes les 5 s : le texte de la météo change la largeur du bouton
        std::thread::sleep(Duration::from_secs(if bar != 0 { 5 } else { 2 }));
    }
}

// ---------- Icônes de notification (une par appareil, fil principal) ----------

static TRAYS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Icône carrée : niveau en gras, réduit jusqu'à tenir, et barre de niveau en bas (RGBA, alpha droit)
fn tray_icon(it: &Item, light: bool) -> Vec<u8> {
    const S: i32 = 32;
    const BAR_H: i32 = 4;
    let (fg, red, blue) = palette(light);
    let txt = match &it.text {
        Some(t) if !t.is_empty() => t.chars().take(2).collect(),
        _ if it.level >= 0 => it.level.min(99).to_string(),
        _ => "?".into(),
    };
    let text_h = S - BAR_H - 2;
    let mut m = Mask::default();
    unsafe {
        let mut fh = text_h * 2;
        while fh >= 6 {
            let f = make_font(fh, FW_BOLD as i32, &["Segoe UI"]);
            m = render_mask(&txt, f, if txt.chars().count() >= 3 { -1 } else { 0 });
            DeleteObject(f as HGDIOBJ);
            if m.w <= S && m.h <= text_h {
                break;
            }
            fh -= 1;
        }
    }
    let scale = if it.dim { 140 } else { 255 };
    let mut out = vec![0u8; (S * S * 4) as usize];
    let mut put = |x: i32, y: i32, c: Rgb, a: i32| {
        if x < 0 || y < 0 || x >= S || y >= S || a <= 0 {
            return;
        }
        let i = ((y * S + x) * 4) as usize;
        out[i..i + 4].copy_from_slice(&[c.0, c.1, c.2, (a * scale / 255) as u8]);
    };
    let tc = if alert(it) { red } else { fg };
    let (ox, oy) = ((S - m.w) / 2, (text_h - m.h) / 2);
    for y in 0..m.h {
        for x in 0..m.w {
            put(ox + x, oy + y, tc, m.a[(y * m.w + x) as usize] as i32);
        }
    }
    let bc = if it.charging { blue } else if alert(it) { red } else if is_stat(&it.kind) { blue } else { fg };
    let fill = if it.level < 0 { 0 } else { ((it.level.min(100) * S + 50) / 100).max(if it.level > 0 { 1 } else { 0 }) };
    for y in S - BAR_H..S {
        for x in 0..S {
            if x < fill {
                put(x, y, bc, 255);
            } else {
                put(x, y, fg, 70);
            }
        }
    }
    out
}

/// Crée, met à jour ou retire les icônes par appareil selon le mode (fil principal uniquement)
pub fn apply_tray(app: &AppHandle) {
    let c = cfg();
    let want = c.mode == "tray" || (c.mode == "taskbar" && FALLBACK.load(Ordering::Relaxed));
    let light = light_taskbar();
    let mut guard = match TRAYS.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    let trays = guard.get_or_insert_with(HashMap::new);
    let all = all_items(&c);
    let items: Vec<&Item> = if want { all.iter().collect() } else { Vec::new() };
    let keep: Vec<String> = items.iter().map(|i| format!("ph-bat-{}", i.key)).collect();
    for id in trays.keys().filter(|k| !keep.contains(k)).cloned().collect::<Vec<_>>() {
        let _ = app.remove_tray_by_id(&id);
        trays.remove(&id);
    }
    for (it, id) in items.into_iter().zip(keep) {
        let tip = format!("{} : {}{}", it.name, level_text(it), if it.charging { " ⚡" } else { "" });
        let sig = format!("{light}|{}|{}|{}|{:?}|{:?}|{tip}", it.level, it.charging, it.dim, it.text, it.tag);
        if trays.get(&id) == Some(&sig) {
            continue;
        }
        let img = Image::new_owned(tray_icon(it, light), 32, 32);
        let ok = match app.tray_by_id(&id) {
            Some(t) => t.set_icon(Some(img)).and_then(|_| t.set_tooltip(Some(&tip))).is_ok(),
            None => TrayIconBuilder::with_id(&id)
                .icon(img)
                .tooltip(&tip)
                .on_tray_icon_event(|t, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        crate::background::show(t.app_handle());
                    }
                })
                .build(app)
                .is_ok(),
        };
        if ok {
            trays.insert(id, sig);
        }
    }
    if c.mode == "tray" {
        set_shown("tray");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(level: i32, charging: bool, dim: bool) -> Item {
        Item { key: "k".into(), name: "n".into(), kind: "souris".into(), level, charging, dim, text: None, tag: None }
    }

    #[test]
    fn icone_de_notification() {
        for (it, light) in [(item(93, false, false), false), (item(12, false, false), false), (item(47, true, false), true), (item(100, false, true), false)] {
            let px = tray_icon(&it, light);
            assert_eq!(px.len(), 32 * 32 * 4);
            // Du texte est dessiné (pixels opaques au-dessus de la barre de niveau)
            assert!(px.chunks(4).take(32 * 26).filter(|p| p[3] > 128).count() > 20);
            // PERIPHHUB_ICONS=dossier : icônes enregistrées en RGBA brut, pour les regarder
            if let Ok(dir) = std::env::var("PERIPHHUB_ICONS") {
                std::fs::write(format!("{dir}/icone-{}-{}-{}.rgba", it.level, it.charging, light), &px).unwrap();
            }
        }
    }

    #[test]
    fn niveau_et_seuil_bas() {
        assert_eq!(level_text(&item(7, false, false)), "7\u{202F}%");
        assert!(is_low(&item(15, false, false)));
        assert!(!is_low(&item(15, true, false)));
        assert!(!is_low(&item(-1, false, false)));
        assert!(!is_low(&item(16, false, false)));
    }

    #[test]
    fn mesures_du_pc() {
        let cpu = |level| Item { kind: "cpu".into(), level, tag: Some("CPU".into()), ..Item::default() };
        assert!(!alert(&cpu(10)));
        assert!(alert(&cpu(95)));
        assert_eq!(level_text(&cpu(-1)), "?");
        let c = Cfg { mode: "taskbar".into(), stats: vec![Stat { key: "ram".into(), label: "RAM".into(), name: "Mémoire".into() }], items: vec![item(50, false, false)], ..Cfg::default() };
        let all = all_items(&c);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].kind, "ram");
        assert_eq!(all[1].kind, "souris");
        assert_eq!(tray_icon(&cpu(42), false).len(), 32 * 32 * 4);
    }

    #[test]
    fn widget_dessine() {
        let stat = |k: &str, l: &str, level| Item { kind: k.into(), level, tag: Some(l.into()), ..Item::default() };
        let items = vec![stat("cpu", "CPU", 23), stat("gpu", "GPU", 94), stat("ram", "RAM", 61), item(80, false, false), Item { kind: "casque".into(), ..item(40, true, false) }];
        for (light, d) in [(false, 96), (true, 144)] {
            let cv = unsafe { compose(&items, 48 * d / 96, d, light, false, false) };
            assert!(cv.w > 200 * d / 96, "{}", cv.w);
            assert!(cv.px.iter().filter(|p| *p >> 24 > 128).count() > 300);
            // PERIPHHUB_ICONS=dossier : ARGB prémultiplié brut (largeur, hauteur dans le nom), pour le regarder
            if let Ok(dir) = std::env::var("PERIPHHUB_ICONS") {
                let raw: Vec<u8> = cv.px.iter().flat_map(|p| p.to_le_bytes()).collect();
                std::fs::write(format!("{dir}/widget-{light}-{}x{}.argb", cv.w, cv.h), raw).unwrap();
            }
        }
    }
}
