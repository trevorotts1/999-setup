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
        // App-owned Rust only. Vendored crates and build output are not ours.
        let files = [
            root.join("src/runtime.rs"),
            root.join("src/single_instance.rs"),
            root.join("src/shell.rs"),
            root.join("src/speech_timing.rs"),
            root.join("speech/mod.rs"),
            root.join("speech/engines.rs"),
        ];
        let mut offenders: Vec<String> = Vec::new();
        for file in files.iter().filter(|f| f.exists()) {
            let text = std::fs::read_to_string(file).expect("source readable");
            let name = file.file_name().unwrap().to_string_lossy().into_owned();
            for (index, line) in text.lines().enumerate() {
                if !line.contains("Command::new") {
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
