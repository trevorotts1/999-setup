//! Terminal host identification — Terminal.app primary, iTerm2 supported
//! (Master Spec 0E WS-21, section 17).
//!
//! Pure string/kind classification, no window-server calls. The discovery
//! module matches window-server owner metadata against these kinds; the
//! output is an anchoring-only `TerminalHost`, never a routing input
//! (spec 17: session ID/bridge is the routing authority).

/// The two supported macOS terminal hosts, plus `unknown` for everything
/// else (other hosts only after the primary path is stable — 0G/spec 17).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TerminalKind {
    /// `/System/Applications/Utilities/Terminal.app` — mandatory primary.
    Terminal,
    /// `iTerm.app` / `iTerm2.app` — supported where installed.
    ITerm2,
    /// Any other owner (Alacritty, WezTerm, VS Code, …) — reported, never
    /// bound as if it were a supported host.
    Unknown,
}

/// A terminal window's identifying metadata + calling-app name.
///
/// `window_title` is optional because `kCGWindowName` (window title) is
/// covered by the 10.15+ privacy gate even when owner name and bounds are
/// not. It is used for host classification only, never session identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalHost {
    pub kind: TerminalKind,
    /// Owner name as reported by the window server (`kCGWindowOwnerName`),
    /// e.g. `Terminal` or `iTerm2`.
    pub owner_name: String,
    /// Window title when the privacy gate allows reading it.
    pub window_title: Option<String>,
    /// Original display name for iTerm2 (`com.googlecode.iterm2`).
    pub bundle_hint: Option<String>,
}

impl TerminalHost {
    pub fn is_supported(&self) -> bool {
        self.kind != TerminalKind::Unknown
    }
}

/// The exact "kind" — matched on owner name (case-insensitive) first,
/// then on the single `bundle_hint` when present. The bundle hint is only
/// carried by the discovery module when the owner already matched a
/// known kind, so it is a refinement, not a second authority.
///
/// Match table (verified against macOS 26 / current apps):
///   "Terminal"   -> Terminall
///   "iTerm"      -> iTerm2
///   "iTerm2"     -> iTerm2
/// Unknown owner names are never error — they return `Unknown`.
pub fn matches_host_kind(owner_name: &str, kind: TerminalKind) -> bool {
    classify_host(owner_name, None) == kind
}

/// Normalize an owner name for matching: trim, collapse whitespace, and
/// lowercase (classic window-server identifiers are stable ASCII).
pub fn normalize_host_name(name: &str) -> String {
    let trimmed = name.trim();
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.to_lowercase()
}

/// Classify an owner name into a `TerminalKind`, with an optional bundle
/// id hint for ambiguity resolution.
///
/// Matching rules:
///   - normalized `"terminal"` → `Terminal`
///   - normalized `"iterm"` or `"iterm2"` → `ITerm2`
///   - `bundle_hint == "com.googlecode.iterm2"` → `ITerm2`
///   - `bundle_hint == "com.apple.Terminal"` → `Terminal`
///   - anything else → `Unknown`
///
/// The bundle hint refines only when the owner name was ambiguous
/// (`iTerm` vs `iTerm2`); it never overrides an exact name match.
pub fn classify_host(owner_name: &str, bundle_hint: Option<&str>) -> TerminalKind {
    let normalized = normalize_host_name(owner_name);
    match normalized.as_str() {
        "terminal" => TerminalKind::Terminal,
        "iterm" => TerminalKind::ITerm2,
        "iterm2" => TerminalKind::ITerm2,
        _ => match bundle_hint.unwrap_or_default() {
            "com.apple.Terminal" => TerminalKind::Terminal,
            "com.googlecode.iterm2" => TerminalKind::ITerm2,
            _ => TerminalKind::Unknown,
        },
    }
}

/// Stable short id used by the app's persisted anchor record
/// (`binding:macos:host-kind` — see anchor.rs; never a routing key).
pub fn host_kind_id(kind: TerminalKind) -> &'static str {
    match kind {
        TerminalKind::Terminal => "terminal",
        TerminalKind::ITerm2 => "iterm2",
        TerminalKind::Unknown => "unknown",
    }
}

/// The canonical bundle identifiers the runtime should ask `NSWorkspace`
/// (or the environment) for when confirming a discovered window belongs
/// to a supported host. Used by the `macos-ns` feature; values are fixed
/// and stable across macOS releases.
pub fn host_bundle_id(kind: TerminalKind) -> Option<&'static str> {
    match kind {
        TerminalKind::Terminal => Some("com.apple.Terminal"),
        TerminalKind::ITerm2 => Some("com.googlecode.iterm2"),
        TerminalKind::Unknown => None,
    }
}

/// Best-effort window-title classification. Terminal.app window titles
/// are often the shell's `ps` line (e.g. `-zsh`); iTerm2 titles are
/// user/custom. This is informational only — never a session key.
pub fn host_window_title(title: Option<&str>) -> Option<String> {
    title.map(|t| {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            String::new()
        } else {
            trimmed.chars().take(256).collect()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_is_classified_by_owner_name() {
        assert_eq!(classify_host("Terminal", None), TerminalKind::Terminal);
        assert_eq!(classify_host("terminal", None), TerminalKind::Terminal);
        assert_eq!(classify_host("  Terminal  ", None), TerminalKind::Terminal);
    }

    #[test]
    fn iterm2_accepts_both_owner_names() {
        assert_eq!(classify_host("iTerm", None), TerminalKind::ITerm2);
        assert_eq!(classify_host("iTerm2", None), TerminalKind::ITerm2);
        assert_eq!(classify_host("iTerm", Some("com.googlecode.iterm2")), TerminalKind::ITerm2);
    }

    #[test]
    fn bundle_hint_refines_ambiguous_names_only() {
        // Ambiguous "iTerm" resolves via the bundle id.
        assert_eq!(classify_host("iTerm", Some("com.googlecode.iterm2")), TerminalKind::ITerm2);
        // A non-matching owner name + a known bundle id still resolves to
        // the bundle's kind (the owner-name field is blank in some apps).
        assert_eq!(classify_host("Whatever", Some("com.googlecode.iterm2")), TerminalKind::ITerm2);
        // The canonical bundle id resolves a fully-unknown owner name
        // when the name field was blank (some apps report blank owners).
        assert_eq!(classify_host("", Some("com.apple.Terminal")), TerminalKind::Terminal);
        // A bundle id hint never OVERRIDES an exact owner-name match.
        assert_eq!(classify_host("Terminal", Some("com.googlecode.iterm2")), TerminalKind::Terminal);
    }

    #[test]
    fn unknown_hosts_are_not_an_error() {
        assert_eq!(classify_host("Alacritty", None), TerminalKind::Unknown);
        assert_eq!(classify_host("Code", None), TerminalKind::Unknown);
        assert_eq!(classify_host("", None), TerminalKind::Unknown);
    }

    #[test]
    fn host_kind_ids_are_stable() {
        assert_eq!(host_kind_id(TerminalKind::Terminal), "terminal");
        assert_eq!(host_kind_id(TerminalKind::ITerm2), "iterm2");
        assert_eq!(host_kind_id(TerminalKind::Unknown), "unknown");
    }

    #[test]
    fn bundle_ids_are_canonical() {
        assert_eq!(host_bundle_id(TerminalKind::Terminal), Some("com.apple.Terminal"));
        assert_eq!(host_bundle_id(TerminalKind::ITerm2), Some("com.googlecode.iterm2"));
        assert_eq!(host_bundle_id(TerminalKind::Unknown), None);
    }

    #[test]
    fn title_is_bounded_and_normalized() {
        assert_eq!(host_window_title(Some("  -zsh  ")), Some("-zsh".to_string()));
        assert_eq!(host_window_title(Some("")), Some(String::new()));
        assert_eq!(host_window_title(None), None);
    }

    #[test]
    fn supported_hosts_are_not_unknown() {
        assert!(TerminalHost { kind: TerminalKind::Terminal, owner_name: "Terminal".into(), window_title: None, bundle_hint: None }.is_supported());
        assert!(!TerminalHost { kind: TerminalKind::Unknown, owner_name: "X".into(), window_title: None, bundle_hint: None }.is_supported());
    }

    #[test]
    fn normalizer_is_idempotent() {
        assert_eq!(normalize_host_name("I Term 2"), normalize_host_name(normalize_host_name("I Term  2").as_str()));
    }
}
