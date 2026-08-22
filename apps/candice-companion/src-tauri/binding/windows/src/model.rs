//! Platform-neutral data model for WS-26 (Windows host-window discovery/binding).
//!
//! Everything in here is safe Rust, `#[derive]`-only; no OS dependency. The
//! real Win32 backend (`win32`) fills these structs; the logic layer (`logic`)
//! reasons over them. The front-end/WS-03 bridge consume the same types, so
//! host-window data can never grow a routing meaning of its own.

#![forbid(unsafe_code)]

use std::fmt;

/// Stable logical id for a discovered top-level window.
///
/// Backed by the HWND (pointer) value on Windows. This is a VISUAL anchor id
/// only; it is never a session identity (spec 17). The WS-03 bridge matches
/// on it for anchor bookkeeping and refuses to route on it alone.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WindowId(pub u64);

impl WindowId {
    /// Render as the stable hex form used in logs and the bridge anchor
    /// ("window-id" kind): `0x000000000001ABCD`.
    pub fn as_anchor_string(&self) -> String {
        format!("0x{:016X}", self.0)
    }
}

impl fmt::Debug for WindowId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "WindowId({})", self.as_anchor_string())
    }
}

/// Device-independent pixel rectangle (logical coordinates; the caller
/// converts to physical pixels with the window's DPI when needed).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub fn right(&self) -> i32 {
        self.left + self.width as i32
    }

    pub fn bottom(&self) -> i32 {
        self.top + self.height as i32
    }

    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }

    /// Physical pixel rect adjusted by the window's DPI scale
    /// (scale = window DPI / 96, the Windows default).
    pub fn to_physical(&self, dpi_scale: f64) -> Rect {
        let s = if dpi_scale.is_finite() && dpi_scale > 0.0 {
            dpi_scale
        } else {
            1.0
        };
        Rect {
            left: (self.left as f64 * s).round() as i32,
            top: (self.top as f64 * s).round() as i32,
            width: (self.width as f64 * s).round() as u32,
            height: (self.height as f64 * s).round() as u32,
        }
    }

    /// Clamped intersection with a work area (monitor working area).
    /// Empty intersection -> an empty Rect at (0,0).
    pub fn intersect(&self, other: &Rect) -> Rect {
        let l = self.left.max(other.left);
        let t = self.top.max(other.top);
        let r = self.right().min(other.right());
        let b = self.bottom().min(other.bottom());
        if r <= l || b <= t {
            return Rect::default();
        }
        Rect {
            left: l,
            top: t,
            width: (r - l) as u32,
            height: (b - t) as u32,
        }
    }
}

/// Which host the top-level window belongs to (spec 17 matrix).
///
/// Determined from the owning process's image name, with the classic
/// console-host exception: a conhost.exe ancestor windows is classified by
/// the closest labeled ancestor (or a separate `Conhost` verdict).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HostKind {
    /// Windows Terminal (tabs/panes; one window, many sessions).
    WindowsTerminal,
    /// Standalone Windows PowerShell 5.1 console host.
    WindowsPowerShell,
    /// Standalone PowerShell 7 (`pwsh.exe`) console host.
    PowerShell7,
    /// Standalone Command Prompt (`cmd.exe`) console host.
    Cmd,
    /// Classic console host whose exact shell is unresolved (conhost.exe
    /// with no labeled ancestor found).
    Conhost,
    /// Anything else — floating-companion fallback territory.
    OpenWindow,
}

impl HostKind {
    /// Human label used in captions/logs.
    pub fn label(&self) -> &'static str {
        match self {
            HostKind::WindowsTerminal => "Windows Terminal",
            HostKind::WindowsPowerShell => "Windows PowerShell",
            HostKind::PowerShell7 => "PowerShell 7 (pwsh)",
            HostKind::Cmd => "Command Prompt (cmd.exe)",
            HostKind::Conhost => "classic console host",
            HostKind::OpenWindow => "open window",
        }
    }

    /// True when one window may host MORE than one Claude session
    /// (Windows Terminal tabs/panes per spec 17). For these hosts the
    /// WS-03 bridge's ambiguity rule is mandatory: a window match alone is
    /// NEVER routing proof.
    pub fn is_multi_session_host(&self) -> bool {
        matches!(self, HostKind::WindowsTerminal)
    }

    /// Classify a lowercased owning-process image name (spec 17 host
    /// matrix). Pure: unit-testable off-Windows. The windows terminal /
    /// powershell / pwsh / cmd / conhost checks are substring-based because
    /// real image names carry versions and paths are already stripped.
    pub fn from_process_image(image: &str) -> HostKind {
        let image = image.to_lowercase();
        if image.contains("windowsterminal") {
            return HostKind::WindowsTerminal;
        }
        if image.contains("pwsh") {
            return HostKind::PowerShell7;
        }
        if image.contains("powershell") {
            return HostKind::WindowsPowerShell;
        }
        if image.contains("cmd") {
            return HostKind::Cmd;
        }
        if image.contains("conhost") {
            return HostKind::Conhost;
        }
        HostKind::OpenWindow
    }
}

/// A discovered candidate top-level window.
///
/// NOTE ON SESSION IDENTITY: this struct never carries a session id. The
/// caller (app integration layer) attaches session proof from the WS-03
/// bridge; until then `session_identity_known` stays false and NO routing or
/// injection decision may be made from this window (spec 17; section 20).
#[derive(Clone, Debug, PartialEq)]
pub struct HostWindow {
    pub id: WindowId,
    /// Owning process image name, lowercased, no path (e.g.
    /// "windowsterminal.exe"). Used only for host classification.
    pub process_image: String,
    /// Owning process id (u32; used only for diagnostics/provenance).
    pub process_id: u32,
    /// Full UTF-16 window title, as reported by GetWindowTextW. Titles are
    /// display metadata only (Windows Terminal titles are user-editable and
    /// per-tab) — never parsed for routing.
    pub title: String,
    /// Window class name (e.g. "CASCADIA_HOSTING_WINDOW_CLASS").
    pub class_name: String,
    /// VISIBLE rect in DIP logical pixels (DWM extended frame bounds when
    /// the backend can supply it; fallback: GetWindowRect).
    pub rect: Rect,
    /// Host classification derived from process image + ancestors.
    pub host_kind: HostKind,
    /// Whether the window is on the current virtual desktop / not cloaked
    /// (DWM cloaking: UWP-style hidden windows and virtual-desktop
    /// switches). `None` = backend could not determine.
    pub cloaked: Option<bool>,
    /// Whether the window is iconic (minimized).
    pub minimized: bool,
    /// Requires the same console provider as this process? (GetConsoleWindow
    /// match: the window hosting OUR console.) Used as a strong-filter input
    /// for the foreground probe — never as a routing authority.
    pub owns_our_console: bool,
    /// Window DPI (from GetDpiForWindow; 96 when unknown).
    pub dpi: u32,
    /// Monitor work area containing the window (logical pixels).
    pub monitor_work_area: Rect,
    /// Handled by the WS-03 bridge/app layer: true ONLY once session proof
    /// has been attached to this window. A discovered window is born false.
    pub session_identity_known: bool,
}

impl HostWindow {
    /// Public display title for diagnostics; never routing input.
    pub fn display_title(&self) -> &str {
        if self.title.is_empty() {
            "(untitled window)"
        } else {
            &self.title
        }
    }

    /// Physical-pixel rect for the renderer.
    pub fn physical_rect(&self) -> Rect {
        self.rect.to_physical(self.dpi as f64 / 96.0)
    }
}

/// Verdict for `discover_and_select` (the discover flow).
#[derive(Clone, Debug, PartialEq)]
pub enum DiscoverVerdict {
    /// Best candidate found; contains the chosen window plus the full
    /// candidate list (so the caller can distinguish anchored-from-foreground
    /// from anchored-from-scratch).
    Found {
        chosen: HostWindow,
        candidates: Vec<HostWindow>,
        /// How the choice was made; provenance for logs and the WS-03 bridge.
        strategy: DiscoveryStrategy,
        /// True when the choice was made from the foreground window
        /// (GetForegroundWindow) that ALSO matches our console provider.
        /// The app may treat this as the "current host" hint, but routing
        /// still requires bridge session proof.
        from_foreground: bool,
    },
    /// No eligible window found (normal before any console exists, during
    /// fast startup, or on a headless session).
    NoneFound { reason: NoWindowReason },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoWindowReason {
    /// No top-level window passed the visibility/ownership filters at all.
    NoCandidate,
    /// Windows Terminal was not found and not elevated/foreground-provable.
    NoEligibleHost,
    /// Every candidate was classified as an owned/unrelated process.
    NoHostWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum DiscoveryStrategy {
    /// Chosen because the window directly hosts our console
    /// (GetConsoleWindow match) — the strongest visual anchor.
    OurConsole,
    /// Chosen because it is the current foreground host window whose
    /// process is a known terminal host.
    ForegroundHost,
    /// Chosen as the single most-recently-activated host-like window.
    MostRecentHost,
}

/// Anchor description handed to the renderer (visual placement only).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    pub window_id: WindowId,
    /// Which side the companion should sit on (default: to the right).
    pub side: AnchorSide,
    /// Gap between host window edge and companion edge (logical px).
    pub gap_px: u32,
    /// DPI scale used for physical rect conversion.
    pub dpi_scale: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AnchorSide {
    Right,
    Left,
    Top,
    Bottom,
}

impl Default for Anchor {
    fn default() -> Self {
        Anchor {
            window_id: WindowId(0),
            side: AnchorSide::Right,
            gap_px: 12,
            dpi_scale: 1.0,
        }
    }
}
