//! Child-process spawn hygiene shared by every lane that shells out.
//!
//! ## Why this exists
//!
//! `main.rs` sets `windows_subsystem = "windows"`, which correctly stops the
//! app itself from owning a console. It does nothing for the app's CHILDREN.
//! On Windows a GUI-subsystem process that spawns a console-subsystem child
//! gets a brand new visible conhost window for that child unless the spawn
//! asks for `CREATE_NO_WINDOW`.
//!
//! Every shell-out in this app is a console program: `tasklist` on every
//! guarded wake, `whisper-cli` on every push-to-talk release, `node` on the
//! startup-recovery pass, a version probe at boot, and the bundled Python TTS
//! worker -- which lives for the entire duration of an utterance. Candice is
//! a transparent, undecorated, always-on-top character. A black command
//! window flashing over her on every wake, and sitting over her the whole
//! time she speaks, is not a cosmetic nit; it is the product not working.
//!
//! macOS has no equivalent problem and no equivalent flag, so this compiles
//! to nothing there.
//!
//! ## Unverified
//!
//! There is no Windows machine in this project, so this is reasoned from the
//! documented behaviour of `CREATE_NO_WINDOW` (0x0800_0000) rather than
//! observed. What IS verified is that the flag is applied at every spawn site
//! the app owns -- `spawn_sites_all_use_the_helper` in this module walks the
//! source and fails if a new `Command::new` appears without it.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

/// <https://learn.microsoft.com/windows/win32/procthread/process-creation-flags>
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Spawn without handing the child a console window.
///
/// Call this on every `Command` before `spawn`/`output`/`status`. It is a
/// no-op on every platform except Windows.
pub(crate) fn no_console(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// The point of a shared helper is that it is used everywhere. A new
    /// shell-out that forgets it would reintroduce the console flash on a
    /// platform nobody here can test on, and nothing would notice.
    ///
    /// So this walks the app's own Rust and requires every `Command::new` to
    /// be paired with the helper. It reads source text, which is crude, but
    /// the alternative is trusting review on a platform with no coverage.
    #[test]
    fn spawn_sites_all_use_the_helper() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        // DISCOVERED, not listed. This used to name six files by hand,
        // which meant a spawn added anywhere else -- a new module, a
        // renamed one, a file someone forgot to add -- passed the test
        // vacuously, on the one platform nobody here can check. A guard
        // that only sees what it was told about is not a guard.
        let files = app_owned_rust(root);
        // CONTROL: a walk that returns nothing would make every assertion
        // below pass for free, which is the failure mode this rewrite
        // exists to remove. Pin both that it found files at all and that
        // it reached the two directories that actually spawn.
        assert!(
            files.len() >= 6,
            "the source walk found only {} files; it is not reaching the tree",
            files.len()
        );
        for expected in ["runtime.rs", "engines.rs"] {
            assert!(
                files.iter().any(|f| f.ends_with(expected)),
                "the source walk never reached {expected}"
            );
        }
        let mut offenders: Vec<String> = Vec::new();
        for file in files.iter().filter(|f| f.exists()) {
            let text = std::fs::read_to_string(file).expect("source readable");
            let name = file.file_name().unwrap().to_string_lossy().into_owned();
            for (index, line) in text.lines().enumerate() {
                if !line.contains("Command::new") {
                    continue;
                }
                // Prose is not a spawn. This module's own documentation
                // discusses `Command::new` by name, and reading a comment
                // as a spawn site would make the guard unsatisfiable.
                if line.trim_start().starts_with("//") {
                    continue;
                }
                // No exemptions. A macOS-only spawn cannot flash a Windows
                // console, but exempting it means maintaining a list that
                // rots, and the helper costs nothing off Windows. "Every
                // Command::new goes through no_console" is a rule a reader
                // can check at a glance; "every one except these" is not.
                // The helper is applied within a few lines of construction;
                // read a small window rather than demanding one exact shape,
                // because the call sites legitimately differ (builder chains,
                // `let mut cmd`, direct `.output()`).
                let window: String = text
                    .lines()
                    .skip(index)
                    .take(14)
                    .collect::<Vec<_>>()
                    .join("\n");
                if !window.contains("no_console") {
                    offenders.push(format!("{name}:{}", index + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these spawn sites do not go through proc::no_console, so they will \
             flash a console window over Candice on Windows: {}",
            offenders.join(", "),
        );
    }

    /// Every `.rs` file this app owns. Vendored crates, the permissions
    /// sub-crate and build output are not ours and are not walked.
    fn app_owned_rust(root: &Path) -> Vec<std::path::PathBuf> {
        let mut found = Vec::new();
        for dir in ["src", "speech"] {
            collect_rust(&root.join(dir), &mut found);
        }
        found.sort();
        found
    }

    fn collect_rust(dir: &Path, found: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_rust(&path, found);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                found.push(path);
            }
        }
    }

    #[test]
    fn the_helper_is_chainable_and_harmless_here() {
        // CONTROL: on macOS this must be a pure no-op that still returns the
        // command, so call sites can chain. If this ever stops compiling or
        // starts altering behaviour on unix, the "no-op elsewhere" claim in
        // the module docs is wrong.
        let mut command = std::process::Command::new("true");
        let built = super::no_console(&mut command);
        assert!(built.get_program().to_string_lossy().contains("true"));
    }
}
