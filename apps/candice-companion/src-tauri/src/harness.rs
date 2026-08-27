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
//! `CLAUDE_CONFIG_DIR`, and this is MEASURED from the launchers themselves,
//! not assumed:
//!
//!   - `claude-nine` and `claude-9` both do
//!     `export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude-nine}"`.
//!   - `claude-codex` execs `claude-nine`, so it inherits the same value.
//!   - `claude` does the opposite on purpose: it matches
//!     `*".claude-nine"*` and UNSETS the variable, precisely so a shell
//!     spawned from inside a Claude-Nine session does not drag the wrong
//!     config into a plain Claude run.
//!
//! That last one is what makes this reliable rather than a guess: the plain
//! harness actively clears the marker, so a set-and-matching value is a
//! positive statement, not a leftover.
//!
//! The value reaches this process because `wake-candice.mjs` spawns the app
//! with no `env:` option, so the child inherits the harness environment
//! whole.
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
pub fn resolve_harness_name(config_dir: Option<&str>, claude_code: bool) -> Option<&'static str> {
    if let Some(dir) = config_dir {
        // Substring, not equality: the launchers default to
        // `$HOME/.claude-nine` but honour a pre-set value, so the path can
        // legitimately be somewhere else and still be a Nine config.
        if dir.contains(".claude-nine") {
            return Some(HARNESS_NINE);
        }
    }
    // No Nine marker but demonstrably inside a harness: plain Claude. This
    // ordering matters -- `CLAUDECODE` is set by BOTH harnesses (same
    // binary), so it can only ever be the fallback, never the test.
    if claude_code {
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
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR").ok();
    let claude_code = std::env::var("CLAUDECODE").is_ok()
        || std::env::var("CLAUDE_CODE_ENTRYPOINT").is_ok();
    Ok(resolve_harness_name(config_dir.as_deref(), claude_code).map(|s| s.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nine_config_dir_names_the_nine_harness() {
        assert_eq!(
            resolve_harness_name(Some("/Users/x/.claude-nine"), true),
            Some(HARNESS_NINE)
        );
        // A relocated Nine config is still Nine.
        assert_eq!(
            resolve_harness_name(Some("/opt/shared/.claude-nine"), true),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn plain_claude_is_named_claude() {
        // `claude` unsets the variable, so this is the shape it presents.
        assert_eq!(resolve_harness_name(None, true), Some(HARNESS_CLAUDE));
        // A non-Nine config dir is still plain Claude.
        assert_eq!(
            resolve_harness_name(Some("/Users/x/.claude"), true),
            Some(HARNESS_CLAUDE)
        );
    }

    #[test]
    fn no_harness_reports_unknown_rather_than_guessing() {
        // A Dock launch. Saying "Claude" here would be a fabrication, and
        // the whole point of this module is to stop naming the wrong window.
        assert_eq!(resolve_harness_name(None, false), None);
    }

    #[test]
    fn nine_wins_even_without_the_claudecode_marker() {
        // CONTROL: the Nine test must not be reachable only through the
        // `claude_code` branch, or a harness that stopped exporting
        // CLAUDECODE would silently start reporting the wrong name.
        assert_eq!(
            resolve_harness_name(Some("/Users/x/.claude-nine"), false),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn windows_paths_are_recognised_too() {
        // UNVERIFIED on a real Windows machine -- there is none in this
        // project -- but the mechanism is checked here rather than assumed.
        // The check is a SUBSTRING test, so it is separator-agnostic by
        // construction: a backslash path carries the same `.claude-nine`
        // marker as a POSIX one. A test that split on '/' would have been a
        // silent Windows-only failure.
        assert_eq!(
            resolve_harness_name(Some(r"C:\Users\trevor\.claude-nine"), true),
            Some(HARNESS_NINE)
        );
        assert_eq!(
            resolve_harness_name(Some(r"C:\Users\trevor\.claude"), true),
            Some(HARNESS_CLAUDE)
        );
        // A UNC path is still just a path.
        assert_eq!(
            resolve_harness_name(Some(r"\\server\share\.claude-nine"), true),
            Some(HARNESS_NINE)
        );
    }

    #[test]
    fn control_the_marker_is_actually_read() {
        // CONTROL: if the config-dir argument were ignored, every assertion
        // above would still pass through the `claude_code` fallback. Prove
        // the two inputs produce DIFFERENT answers for the same second arg.
        let nine = resolve_harness_name(Some("/Users/x/.claude-nine"), true);
        let plain = resolve_harness_name(Some("/Users/x/.claude"), true);
        assert_ne!(nine, plain, "the config dir must change the answer");
    }
}
