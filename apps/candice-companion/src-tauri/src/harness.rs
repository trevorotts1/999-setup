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
//! `CANDICE_PLUGIN_ROOT` -- the plugin's own location, handed over by the
//! plugin at the moment it spawns this app.
//!
//! This used to read `CLAUDE_CONFIG_DIR`, and the comment here claimed that
//! was "MEASURED from the launchers". It was measured from the operator's
//! own personal launcher, NOT from the launchers this repo ships. All four
//! shipped launcher files under `launchers/macos` and `launchers/windows`
//! contain zero references to that variable -- measured, with a control:
//! the same grep finds `ANTHROPIC_BASE_URL` in two of the four, so the zero
//! is a real absence. Never setting it is a stated product invariant.
//!
//! So on every client machine the second harness presented no config dir at
//! all, only the generic `CLAUDECODE` marker, and this module answered
//! "Claude": the precise wrong-window failure it exists to prevent, and
//! confidently wrong rather than honestly unknown.
//!
//! The plugin can answer what the app cannot, because it knows where the
//! harness loaded it FROM -- Claude Code installs plugins beneath its own
//! config root, so the plugin's path sits under one config directory or the
//! other. That is in-force truth rather than a file's intent.
//!
//! ## Why the CLASSIFYING happens here and not there
//!
//! The plugin hands over a PATH and does not interpret it. WS-42 requires
//! the shipped plugin to carry zero coupling to how the session was
//! launched: a routed session and a plain session must walk the same code.
//! An earlier cut of this fix classified inside the plugin, which broke that
//! invariant in substance, and `tests/same-session` caught it.
//!
//! Naming a window is presentation, and presentation is what this app IS.
//! So the plugin reports where it lives, unconditionally and identically in
//! both worlds, and the decision lands here.
//!
//! `CLAUDE_CONFIG_DIR` is still honoured as a second signal, because the
//! operator's own boxes DO set it and it is correct where present.
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
    plugin_root: Option<&str>,
    config_dir: Option<&str>,
) -> Option<&'static str> {
    // Where the running harness actually loaded the plugin from. Checked
    // first because it reflects THIS launch, while a config dir can be
    // inherited from a shell opened inside the other harness.
    if let Some(root) = plugin_root {
        if let Some(name) = harness_from_path(root) {
            return Some(name);
        }
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
    let plugin_root = std::env::var("CANDICE_PLUGIN_ROOT").ok();
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR").ok();
    Ok(
        resolve_harness_name(plugin_root.as_deref(), config_dir.as_deref())
            .map(|s| s.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const NINE_PLUGIN: &str = "/Users/x/.claude-nine/plugins/repos/bc/candice-integration";
    const PLAIN_PLUGIN: &str = "/Users/x/.claude/plugins/repos/bc/candice-integration";

    #[test]
    fn the_plugins_location_names_the_harness() {
        assert_eq!(resolve_harness_name(Some(NINE_PLUGIN), None), Some(HARNESS_NINE));
        assert_eq!(resolve_harness_name(Some(PLAIN_PLUGIN), None), Some(HARNESS_CLAUDE));
    }

    #[test]
    fn the_plugin_location_beats_an_inherited_config_dir() {
        // A shell opened from inside one harness can carry the other's
        // CLAUDE_CONFIG_DIR. Where THIS launch loaded the plugin from wins.
        assert_eq!(
            resolve_harness_name(Some(PLAIN_PLUGIN), Some("/Users/x/.claude-nine")),
            Some(HARNESS_CLAUDE)
        );
    }

    #[test]
    fn an_uninformative_plugin_path_falls_through_to_the_config_dir() {
        // A dev checkout is under neither config root. It must not veto a
        // config dir that does know.
        assert_eq!(
            resolve_harness_name(Some("/Users/x/candice-integration/plugins/candice-integration"), Some("/Users/x/.claude-nine")),
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
        // shape a client machine presented. It used to answer "Claude" off
        // the CLAUDECODE marker -- which BOTH harnesses set -- and so named
        // the wrong window to every user of the other harness. Unknown
        // renders as "your terminal", which is true.
        assert_eq!(resolve_harness_name(None, None), None);
        assert_eq!(resolve_harness_name(Some("/opt/somewhere"), None), None);
    }

    #[test]
    fn nine_is_not_matched_by_substring() {
        // `.claude-nine` contains `.claude`, and `.claude-nineteen`
        // contains `.claude-nine`. Component matching settles both.
        assert_eq!(resolve_harness_name(None, Some("/Users/x/.claude-nineteen")), None);
        assert_eq!(
            resolve_harness_name(Some("/Users/x/.claude-nine/plugins"), None),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn windows_paths_are_recognised_too() {
        // UNVERIFIED on a real Windows machine -- there is none in this
        // project -- but the mechanism is checked rather than assumed.
        assert_eq!(
            resolve_harness_name(Some(r"C:\Users\trevor\.claude-nine\plugins\p"), None),
            Some(HARNESS_NINE)
        );
        assert_eq!(
            resolve_harness_name(Some(r"C:\Users\trevor\.claude\plugins\p"), None),
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
            resolve_harness_name(Some(NINE_PLUGIN), None),
            resolve_harness_name(Some(PLAIN_PLUGIN), None),
            "the plugin location must change the answer"
        );
        assert_ne!(
            resolve_harness_name(None, Some("/x/.claude-nine")),
            resolve_harness_name(None, Some("/x/.claude")),
            "the config dir must change the answer"
        );
    }
}
