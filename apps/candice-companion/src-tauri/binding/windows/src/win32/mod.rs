//! Real Win32 backend for WS-26 (compiled only on Windows with feature
//! `win32`; the module itself is additionally `#[cfg(windows)]`).
//!
//! Implements `Win32WindowSource` over the native API surface:
//!   - `EnumWindows` (top-level windows) + `IsWindowVisible` + root-owner
//!     walk for the classic console host classification;
//!   - `GetWindowThreadProcessId` + `QueryFullProcessImageNameW` for the
//!     owning-process image (host classification);
//!   - `GetWindowTextW` / `GetClassNameW` (display metadata ONLY — never
//!     parsed for routing, spec 17);
//!   - `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` for the
//!     pixel-accurate visible rect (fallback `GetWindowRect`), and
//!     `DWMWA_CLOAKED` for virtual-desktop/start-menu cloaking;
//!   - `IsIconic` (minimized), `GetDpiForWindow`;
//!   - `MonitorFromWindow(MONITOR_DEFAULTTONEAREST)` + `GetMonitorInfoW` for
//!     the monitor work area;
//!   - `GetConsoleWindow` for the owns-our-console signal.
//!
//! Safety discipline:
//!   - every FFI-callable block is an explicit `unsafe {}`;
//!   - the EnumWindows callback runs synchronously inside the call, so a
//!     `Vec<HWND>` pointer passed through LPARAM is valid for the whole walk
//!     and is never retained;
//!   - buffers are fixed-size with checked/limited lengths;
//!   - HWNDs are opaque ids here — never dereferenced.
//!
//! This module is the ONLY unsafe code in this crate; `model`/`logic` are
//! `#![forbid(unsafe_code)]`.

use crate::logic::discover::Win32WindowSource;
use crate::model::{HostKind, HostWindow, Rect, WindowId};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowRect,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    GA_ROOT, GW_OWNER,
};

/// Max window-title chars we read. GetWindowTextLengthW can change between
/// calls; we cap and re-read, never trust the reported length for a huge
/// allocation.
const MAX_TITLE_CHARS: usize = 1024;
const MAX_CLASS_CHARS: usize = 256;
const MAX_IMAGE_CHARS: usize = 260; // MAX_PATH
const MAX_OWNER_WALK: u32 = 8;

#[derive(Default)]
pub struct Win32Backend;

impl Win32Backend {
    pub fn new() -> Self {
        Win32Backend
    }
}

fn win32_rect_to_model(r: &windows::Win32::Foundation::RECT) -> Rect {
    let width = r.right.saturating_sub(r.left).max(0) as u32;
    let height = r.bottom.saturating_sub(r.top).max(0) as u32;
    Rect {
        left: r.left,
        top: r.top,
        width,
        height,
    }
}

fn window_id(hwnd: HWND) -> WindowId {
    WindowId(hwnd.0 as u64)
}

fn window_title(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let cap = (len as usize).min(MAX_TITLE_CHARS) + 1;
        let mut buf = vec![0u16; cap];
        let read = GetWindowTextW(hwnd, &mut buf);
        if read <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..read as usize])
    }
}

fn window_class(hwnd: HWND) -> String {
    unsafe {
        let mut buf = vec![0u16; MAX_CLASS_CHARS];
        let n = GetClassNameW(hwnd, &mut buf);
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }
}

/// Owning-process image name (lowercased, no path) via
/// QueryFullProcessImageNameW with PROCESS_QUERY_LIMITED_INFORMATION, so no
/// debug-level handle is needed.
fn process_image(process_id: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut buf = vec![0u16; MAX_IMAGE_CHARS];
        let mut size = buf.len() as u32;
        let res = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        res.ok()?;
        let wide = &buf[..(size as usize).min(buf.len())];
        let path = String::from_utf16_lossy(wide);
        let name = path.rsplit(['\\', '/']).next().unwrap_or(&path);
        Some(name.to_lowercase())
    }
}

fn process_id_of(hwnd: HWND) -> Option<u32> {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    if pid == 0 {
        None
    } else {
        Some(pid)
    }
}

fn visible_rect(hwnd: HWND) -> Rect {
    // DWM extended frame bounds: the pixel-accurate visible rect (excludes
    // invisible borders). Fallback: GetWindowRect.
    let mut dwm_rect = windows::Win32::Foundation::RECT::default();
    let dwm_ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut dwm_rect as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<windows::Win32::Foundation::RECT>() as u32,
        )
        .is_ok()
    };
    if dwm_ok {
        return win32_rect_to_model(&dwm_rect);
    }
    let mut r = windows::Win32::Foundation::RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut r) }.is_ok() {
        return win32_rect_to_model(&r);
    }
    Rect::default()
}

fn monitor_work_area(hwnd: HWND) -> Rect {
    unsafe {
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if mon.is_invalid() {
            return Rect::default();
        }
        // rcWork is the taskbar-excluded work area; rcMonitor is the full
        // screen. Use the work area (spec 17: follow monitor changes with a
        // usable bound).
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(mon, &mut info);
        win32_rect_to_model(&info.rcWork)
    }
}

fn cloaked(hwnd: HWND) -> Option<bool> {
    let mut value: u32 = 0;
    let ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut value as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
    };
    ok.then_some(value != 0)
}

fn dpi(hwnd: HWND) -> u32 {
    unsafe { GetDpiForWindow(hwnd) }
}

/// Does this window host OUR console? GetConsoleWindow() returns the window
/// of the current console; if hwnd equals it (or shares a root owner with
/// it), yes. This is the strongest visual anchor available on Windows and
/// is used only as one (never a routing input).
fn owns_our_console(hwnd: HWND) -> bool {
    unsafe {
        let ours = windows::Win32::System::Console::GetConsoleWindow();
        if ours.is_invalid() {
            return false;
        }
        if hwnd == ours {
            return true;
        }
        // A console's visible top-level window may be owned by conhost with
        // the console HWND as its owner-walk root; compare roots.
        let root = GetAncestor(hwnd, GA_ROOT);
        if root.is_invalid() {
            return false;
        }
        root == ours || root == GetAncestor(ours, GA_ROOT)
    }
}

/// Host classification from the owning-process image name (spec 17 matrix).
/// Delegates to the pure `HostKind::from_process_image` in `model` so the
/// rule is testable off-Windows.
fn classify(process_image: &str) -> HostKind {
    HostKind::from_process_image(process_image)
}

/// For a conhost-owned window, walk its owner chain (bounded) and classify
/// by the nearest ancestor window whose owning process is a known host.
fn nearest_host_kind(root: HWND) -> Option<HostKind> {
    let mut current = root;
    for _ in 0..MAX_OWNER_WALK {
        let owner = unsafe { GetWindow(current, GW_OWNER) }.ok()?;
        if owner.is_invalid() {
            return None;
        }
        if let Some(pid) = process_id_of(owner) {
            if let Some(image) = process_image(pid) {
                let kind = classify(&image);
                if kind != HostKind::OpenWindow {
                    return Some(kind);
                }
            }
        }
        current = owner;
    }
    None
}

/// Snapshot a single HWND into the model. Returns None when the window is
/// invisible, empty, or cannot be identified.
fn window_snapshot(hwnd: HWND) -> Option<HostWindow> {
    if !unsafe { IsWindowVisible(hwnd).as_bool() } {
        return None;
    }
    let pid = process_id_of(hwnd)?;
    let image = process_image(pid).unwrap_or_default();
    let mut host_kind = classify(&image);
    if host_kind == HostKind::Conhost {
        host_kind = nearest_host_kind(hwnd).unwrap_or(HostKind::Conhost);
    }

    let rect = visible_rect(hwnd);
    if rect.is_empty() {
        return None;
    }

    Some(HostWindow {
        id: window_id(hwnd),
        process_image: image,
        process_id: pid,
        title: window_title(hwnd),
        class_name: window_class(hwnd),
        rect,
        host_kind,
        cloaked: cloaked(hwnd),
        minimized: unsafe { IsIconic(hwnd).as_bool() },
        owns_our_console: owns_our_console(hwnd),
        dpi: dpi(hwnd),
        monitor_work_area: monitor_work_area(hwnd),
        session_identity_known: false,
    })
}

/// EnumWindows callback context: the Vec<HWND> collector pointer travels in
/// LPARAM. SAFETY: EnumWindows calls the callback synchronously inside the
/// EnumWindows call, so the pointer is valid for the entire walk and is
/// never stored beyond it. The callback continues enumeration except on
/// allocation failure (empty Vec after the walk is handled by callers).
unsafe extern "system" fn enum_collect(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let collector = lparam.0 as *mut Vec<HWND>;
    if collector.is_null() {
        return windows::core::BOOL(0);
    }
    // SAFETY: EnumWindows calls this callback synchronously while the
    // caller's `collector` Vec (whose pointer travels in LPARAM) is alive
    // and uniquely borrowed; the pointer never escapes this call.
    unsafe {
        (*collector).push(hwnd);
    }
    windows::core::BOOL(1)
}

/// Raw top-level-window enumeration. Collects HWND ids only; snapshots are
/// taken afterwards (snapshotting inside the callback would risk re-entrant
/// enumeration and long callbacks blocking the UI thread).
fn enumerate_top_level() -> Vec<HWND> {
    let mut collector: Vec<HWND> = Vec::new();
    let ptr = &mut collector as *mut Vec<HWND>;
    unsafe {
        let _ = EnumWindows(Some(enum_collect), LPARAM(ptr as isize));
    }
    collector
}

impl Win32WindowSource for Win32Backend {
    fn list_all(&self) -> Vec<HostWindow> {
        let mut out = Vec::new();
        for hwnd in enumerate_top_level() {
            if let Some(w) = window_snapshot(hwnd) {
                out.push(w);
            }
        }
        out
    }

    fn foreground(&self) -> Option<HostWindow> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() {
            return None;
        }
        window_snapshot(hwnd)
    }
}
