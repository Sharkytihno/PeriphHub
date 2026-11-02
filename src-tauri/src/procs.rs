// Liste des processus en cours : nom, parent, mémoire vive (working set) et chemin de l'exe.
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

pub struct Proc {
    pub pid: u32,
    pub parent: u32,
    pub name: String,
    pub bytes: u64,
    pub path: Option<String>,
}

#[link(name = "ntdll")]
extern "system" {
    fn NtQuerySystemInformation(class: u32, buf: *mut u8, len: u32, ret: *mut u32) -> i32;
}

// Mémoire de TOUS les processus, y compris les services système, sans droits administrateur
// (même source que le Gestionnaire des tâches). Disposition x64 de SYSTEM_PROCESS_INFORMATION :
// NextEntryOffset @0, WorkingSetPrivateSize @0x08 (colonne « Mémoire » du Gestionnaire des tâches :
// sans double comptage de la mémoire partagée entre processus), UniqueProcessId @0x50.
fn working_sets() -> std::collections::HashMap<u32, u64> {
    let mut map = std::collections::HashMap::new();
    let mut size = 1u32 << 20;
    for _ in 0..5 {
        let mut buf = vec![0u8; size as usize];
        let mut ret = 0u32;
        let st = unsafe { NtQuerySystemInformation(5, buf.as_mut_ptr(), size, &mut ret) };
        if st == 0xC000_0004u32 as i32 {
            size = ret.max(size) + (1 << 18);
            continue;
        }
        if st != 0 {
            return map;
        }
        let mut off = 0usize;
        loop {
            let at = |o: usize| usize::from_le_bytes(buf[off + o..off + o + 8].try_into().unwrap());
            let next = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap()) as usize;
            map.insert(at(0x50) as u32, at(0x08) as u64);
            if next == 0 || off + next + 0x98 > buf.len() {
                break;
            }
            off += next;
        }
        return map;
    }
    map
}

pub fn list() -> Vec<Proc> {
    let ws = working_sets();
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e);
        while ok != 0 {
            if e.th32ProcessID != 0 {
                let n = e
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(e.szExeFile.len());
                let (own, path) = info(e.th32ProcessID);
                let bytes = ws
                    .get(&e.th32ProcessID)
                    .copied()
                    .filter(|&b| b > 0)
                    .unwrap_or(own);
                out.push(Proc {
                    pid: e.th32ProcessID,
                    parent: e.th32ParentProcessID,
                    name: String::from_utf16_lossy(&e.szExeFile[..n]),
                    bytes,
                    path,
                });
            }
            ok = Process32NextW(snap, &mut e);
        }
        CloseHandle(snap);
    }
    out
}

// Mémoire vive et chemin ; (0, None) si Windows refuse l'accès (processus protégé)
fn info(pid: u32) -> (u64, Option<String>) {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return (0, None);
        }
        let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let bytes = if K32GetProcessMemoryInfo(h, &mut c, c.cb) != 0 {
            c.WorkingSetSize as u64
        } else {
            0
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let path = (QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
            != 0)
            .then(|| String::from_utf16_lossy(&buf[..len as usize]));
        CloseHandle(h);
        (bytes, path)
    }
}

pub fn current_pid() -> u32 {
    unsafe { GetCurrentProcessId() }
}

pub fn total_ram() -> u64 {
    let mut ms: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    ms.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut ms) };
    ms.ullTotalPhys
}
