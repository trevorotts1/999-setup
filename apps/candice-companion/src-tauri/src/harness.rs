//! Which harness is Candice working with -- Claude, or Claude-Nine?
//!
//! ## Why this exists
//!
//! Every user-facing string in this app said "Claude". The operator does not
//! run one harness, he runs several: `claude`, `claude-nine`, `claude-9` and
//! `claude-codex`. So the message he actually saw on screen -- "Keep
//! answering in the Claude window" -- named a window that was not the one he
//! was looking at. Naming the wrong window is worse than naming none: it
//! sends a stuck user to the wrong place.
//!
//! ## How the harness is identified
//!
//! `CANDICE_HARNESS`, set by the plugin at the moment it spawns this app.
//!
//! This used to read `CLAUDE_CONFIG_DIR`, and the comment here claimed that
//! was "MEASURED from the launchers". It was measured from the operator's
//! own personal launcher, NOT from the launchers this repo ships. All four
//! shipped launchers -- `launchers/macos/claude-nine`,
//! `launchers/macos/claude-codex`, `launchers/windows/claude-nine.cmd` and
//! `launchers/windows/claude-nine.ps1` -- contain zero references to that
//! variable, and never setting it is a stated product invariant. So on every
//! client machine a Claude-Nine session presented no config dir at all, only
//! the generic `CLAUDECODE` marker, and this module answered "Claude": the
//! precise wrong-window failure it exists to prevent, and confidently wrong
//! rather than honestly unknown.
//!
//! The plugin can answer this and the app cannot, because the plugin knows
//! where the harness loaded it FROM -- Claude Code installs plugins beneath
//! its own config root, so the plugin's own path sits under `.claude-nine/`
//! or `.claude/`. That is in-force truth rather than a file's intent. See
//! `plugins/candice-integration/shared/launch-command.js`, which owns the
//! derivation for both launch paths.
//!
//! `CLAUDE_CONFIG_DIR` is still honoured as a second signal, because the
//! operator's own boxes DO set it and it is correct where present. It is no
//! longer the only one.
//!
//! `CLAUDECODE` is deliberately NOT consulted. Both harnesses are the same
//! binary and both set it, so it can never tell them apart. Reading a name
//! out of it was the bug.
//!
//! ## What this deliberately does NOT do
//!
//! It does not add a field to the bridge `question` frame. That frame is
//! versioned and parsed strictly on this side; widening it to carry a label
//! would risk every question to buy a cosmetic gain.
//!
//! The consequence is a known and accepted limit: this app is
//! single-instance, so if Candice is already running for one harness and a
//! second harness wakes her, the name stays the one that launched her. The
//! fallback below is what keeps that honest -- when we were not told, we say
//! "your terminal" rather than picking a harness and being confidently wrong.

/// Display name of the harness, or `None` when this process was not started
/// from one (a Dock launch, a direct double-click, a test).
///
/// Split from the environment read so it can be tested without mutating
/// process-global state, which is not safe under a parallel test runner.
pub fn resolve_harness_name(
    explicit: Option<&str>,
    config_dir: Option<&str>,
) -> Option<&'static str> {
    // Stated outright by the plugin. The only signal that is a positive
    // claim rather than an inference.
    match explicit {
        Some(HARNESS_NINE) => return Some(HARNESS_NINE),
        Some(HARNESS_CLAUDE) => return Some(HARNESS_CLAUDE),
        // An unrecognised value is discarded rather than echoed. This
        // command's contract is a known harness or nothing.
        _ => {}
    }
    if let Some(dir) = config_dir {
        return harness_from_path(dir);
    }
    None
}

/// The config root named by a path, by EXACT component match.
///
/// Not a substring test: `".claude-nine"` contains `".claude"`, so a
/// substring check is correct only for as long as someone keeps the two
/// arms in the right order, and `".claude-nineteen"` would read as Nine.
/// Splitting on both separators keeps one code path correct on Windows.
fn harness_from_path(dir: &str) -> Option<&'static str> {
    let mut saw_claude = false;
    for part in dir.split(['/', '\\']).filter(|p| !p.is_empty()) {
        if part == ".claude-nine" {
            return Some(HARNESS_NINE);
        }
        if part == ".claude" {
            saw_claude = true;
        }
    }
    if saw_claude {
        return Some(HARNESS_CLAUDE);
    }
    None
}

/// The plain harness.
pub const HARNESS_CLAUDE: &str = "Claude";
/// The Nine harness (`claude-nine`, `claude-9`, `claude-codex`).
pub const HARNESS_NINE: &str = "Claude-Nine";

/// Read the live environment. Returns `null` in JSON when unknown, which the
/// front end renders as "your terminal".
#[tauri::command]
pub fn cmd_get_harness_name() -> Result<Option<String>, String> {
    let explicit = std::env::var("CANDICE_HARNESS").ok();
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR").ok();
    Ok(
        resolve_harness_name(explicit.as_deref(), config_dir.as_deref())
            .map(|s| s.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plugins_explicit_answer_is_taken() {
        assert_eq!(resolve_harness_name(Some("Claude-Nine"), None), Some(HARNESS_NINE));
        assert_eq!(resolve_harness_name(Some("Claude"), None), Some(HARNESS_CLAUDE));
    }

    #[test]
    fn the_explicit_answer_beats_a_stale_config_dir() {
        // A shell opened from inside one harness can carry the other's
        // CLAUDE_CONFIG_DIR. What launched THIS app wins.
        assert_eq!(
            resolve_harness_name(Some("Claude"), Some("/Users/x/.claude-nine")),
            Some(HARNESS_CLAUDE)
        );
    }

    #[test]
    fn an_unrecognised_explicit_value_is_discarded_not_echoed() {
        // Never render an arbitrary string into "answer in <x>".
        assert_eq!(resolve_harness_name(Some("Cursor"), None), None);
        assert_eq!(resolve_harness_name(Some(""), None), None);
        // ...but it must not poison a config dir that DOES know.
        assert_eq!(
            resolve_harness_name(Some("Cursor"), Some("/Users/x/.claude-nine")),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn config_dir_still_answers_on_boxes_that_set_it() {
        assert_eq!(resolve_harness_name(None, Some("/Users/x/.claude-nine")), Some(HARNESS_NINE));
        assert_eq!(resolve_harness_name(None, Some("/Users/x/.claude")), Some(HARNESS_CLAUDE));
    }

    #[test]
    fn nothing_known_reports_unknown_rather_than_guessing() {
        // THE REGRESSION THIS MODULE WAS REWRITTEN FOR. Every shipped
        // launcher leaves CLAUDE_CONFIG_DIR unset, so this is the exact
        // shape a client machine presents. It used to answer "Claude" off
        // the CLAUDECODE marker -- which BOTH harnesses set -- and so named
        // the wrong window to every Claude-Nine user. Unknown renders as
        // "your terminal", which is true.
        assert_eq!(resolve_harness_name(None, None), None);
        // A path that is under neither config root says nothing.
        assert_eq!(resolve_harness_name(None, Some("/opt/somewhere")), None);
    }

    #[test]
    fn nine_is_not_matched_by_substring() {
        // `.claude-nine` contains `.claude`, and `.claude-nineteen`
        // contains `.claude-nine`. Component matching settles both.
        assert_eq!(resolve_harness_name(None, Some("/Users/x/.claude-nineteen")), None);
        assert_eq!(
            resolve_harness_name(None, Some("/Users/x/.claude-nine/plugins")),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn windows_paths_are_recognised_too() {
        // UNVERIFIED on a real Windows machine -- there is none in this
        // project -- but the mechanism is checked rather than assumed.
        assert_eq!(
            resolve_harness_name(None, Some(r"C:\Users\trevor\.claude-nine")),
            Some(HARNESS_NINE)
        );
        assert_eq!(
            resolve_harness_name(None, Some(r"C:\Users\trevor\.claude")),
            Some(HARNESS_CLAUDE)
        );
        assert_eq!(
            resolve_harness_name(None, Some(r"\\server\share\.claude-nine")),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn control_each_signal_independently_changes_the_answer() {
        // CONTROL: if either argument were ignored, assertions above would
        // pass vacuously through the other. Vary exactly one at a time.
        assert_ne!(
            resolve_harness_name(Some("Claude-Nine"), None),
            resolve_harness_name(Some("Claude"), None),
            "the explicit signal must change the answer"
        );
        assert_ne!(
            resolve_harness_name(None, Some("/x/.claude-nine")),
            resolve_harness_name(None, Some("/x/.claude")),
            "the config dir must change the answer"
        );
    }
}
