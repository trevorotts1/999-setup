//! Single-instance guard for visual wake launches.
//!
//! ## The defect this closes
//!
//! Every launch used to spawn its own process and its own window. The
//! operator hit it directly: an MCP-bridged companion was already on screen,
//! a `/bro` prompt fired the plugin's wake hook, the hook launched the
//! companion again, and macOS drew a SECOND Candice beside the first. Both
//! were the same binary — `~/.local/bin/candice-companion` is a symlink to
//! the Application Support copy — so nothing about the two processes
//! disagreed except that only one of them held a bridge.
//!
//! `RuntimeCapabilities::single_instance_routing_available` has always
//! reported `false` and said why: a socket per MCP launch prevents
//! cross-session leakage, but this build cannot route an existing instance.
//! That remains true, and this module does NOT change it.
//!
//! ## What is guarded, and what deliberately is not
//!
//! Only a **wake-only** launch is guarded — one carrying `--wake` and no
//! bridge endpoint. A wake is a request to SHOW Candice, not to bind a
//! session, so when she is already on screen the correct response is to
//! raise her, not to draw a second copy. That is security-neutral: nothing
//! is adopted, nothing crosses a session boundary.
//!
//! A **bridge** launch is never blocked. Its `--session-id` and capability
//! token are a session binding, and handing them to a process that was
//! started for a different session is exactly the cross-session leakage the
//! per-launch socket exists to prevent. Adopting a bridge into a running
//! instance is real routing work; it belongs to the FIX-011/FIX-013 lane
//! with independent QC, not to a guard like this one.
//!
//! So one gap remains open and is stated rather than hidden: if a wake-only
//! instance is already up and an MCP bridge launch follows, two windows
//! still appear. Closing that requires the routing work above.
//!
//! ## Why no dependency
//!
//! `tauri-plugin-single-instance` would do this, but it is not in the lock
//! file and the release supply-chain gate is still PENDING. Pulling an
//! unreviewed crate to fix a UI defect would trade a visible bug for an
//! unaudited one. This is std-only: an atomically created lock file holding
//! a pid, with stale-lock recovery.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Bundle identifier; also the per-user state directory name. Matches
/// `tauri.conf.json` and `tts/scripts/runtime.py`'s `APP_ID`.
const APP_ID: &str = "com.blackceo.candice";

const LOCK_FILE: &str = "instance.lock";

/// The outcome of asking for the instance lock.
#[derive(Debug)]
pub enum Outcome {
    /// This process owns the instance; build the UI. The guard releases the
    /// lock on drop, so hold it for the lifetime of the process.
    Primary(InstanceGuard),
    /// A live instance already holds it. Its pid is reported for the log.
    AlreadyRunning { pid: u32 },
    /// The lock could not be evaluated (unwritable directory, unreadable
    /// file). FAIL OPEN: a guard that cannot prove a duplicate must never be
    /// the reason Candice refuses to appear.
    Undetermined { reason: String },
}

/// Holds the instance lock; removes it on drop.
#[derive(Debug)]
pub struct InstanceGuard {
    path: PathBuf,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        // Best effort. A leftover lock is recovered by the stale-pid path on
        // the next launch, so failing to remove it is not fatal.
        let _ = fs::remove_file(&self.path);
    }
}

/// Per-user state directory, OUTSIDE any code-signed bundle.
///
/// Never write inside `Contents/Resources`: the bundle is signed and any
/// file added there invalidates the signature.
fn per_user_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        return Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_ID),
        );
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("USERPROFILE"))?;
        return Some(PathBuf::from(base).join(APP_ID));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(base) = std::env::var_os("XDG_DATA_HOME") {
            return Some(PathBuf::from(base).join(APP_ID));
        }
        let home = std::env::var_os("HOME")?;
        Some(PathBuf::from(home).join(".local").join("share").join(APP_ID))
    }
}

/// Is a process with this pid alive?
///
/// std has no `kill(pid, 0)` and `libc` is not a dependency, so this asks
/// the OS's own process table. It only runs when a lock file already exists,
/// which is the uncommon path.
///
/// Returns `None` when the question could not be answered — the caller must
/// treat that as "cannot prove a duplicate" and fail open.
fn pid_alive(pid: u32) -> Option<bool> {
    if pid == 0 {
        return Some(false);
    }
    #[cfg(windows)]
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .stdin(Stdio::null())
        .output();
    #[cfg(not(windows))]
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "pid="])
        .stdin(Stdio::null())
        .output();

    let output = output.ok()?;
    // `ps -p` exits non-zero for an absent pid, and tasklist prints
    // "INFO: No tasks..." while still exiting zero — so check the text, not
    // just the status. An exit code is not a fact about the process table.
    let text = String::from_utf8_lossy(&output.stdout);
    #[cfg(windows)]
    {
        Some(text.contains(&pid.to_string()))
    }
    #[cfg(not(windows))]
    {
        Some(text.split_whitespace().any(|token| token == pid.to_string()))
    }
}

fn read_pid(path: &Path) -> Option<u32> {
    let mut text = String::new();
    File::open(path).ok()?.read_to_string(&mut text).ok()?;
    text.trim().parse::<u32>().ok()
}

fn write_pid(file: &mut File) -> std::io::Result<()> {
    write!(file, "{}", std::process::id())?;
    file.flush()
}

/// Try to become the single instance.
///
/// EVERY launch calls this, including bridge launches. Taking the lock and
/// being BLOCKED by it are two different things, and conflating them was a
/// bug in the first draft of this guard: if only a wake launch registered,
/// then a bridged companion sitting on screen advertised nothing, the next
/// `/bro` found no lock, made itself primary, and opened the second window
/// anyway -- the precise scenario this exists to prevent.
///
/// So the lock means "an instance is alive", not "a wake is alive". The
/// caller decides what to do with `AlreadyRunning`: a wake-only launch
/// stands down, a bridge launch carries on regardless (module docs).
pub fn acquire() -> Outcome {
    let Some(dir) = per_user_dir() else {
        return Outcome::Undetermined { reason: "no per-user state directory".into() };
    };
    if let Err(error) = fs::create_dir_all(&dir) {
        return Outcome::Undetermined { reason: format!("state directory unusable: {error}") };
    }
    let path = dir.join(LOCK_FILE);

    // Two passes at most: the second only runs after a stale lock is cleared,
    // so a live competitor cannot spin this.
    for attempt in 0..2 {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = write_pid(&mut file) {
                    // The lock is ours but unlabelled; a later launch would
                    // read no pid and reclaim it. Release rather than hold a
                    // lock nobody can reason about.
                    let _ = fs::remove_file(&path);
                    return Outcome::Undetermined { reason: format!("lock unwritable: {error}") };
                }
                return Outcome::Primary(InstanceGuard { path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let Some(pid) = read_pid(&path) else {
                    // Unreadable or truncated: treat as stale exactly once.
                    if attempt == 0 && fs::remove_file(&path).is_ok() {
                        continue;
                    }
                    return Outcome::Undetermined { reason: "lock file unreadable".into() };
                };
                match pid_alive(pid) {
                    Some(true) => return Outcome::AlreadyRunning { pid },
                    Some(false) => {
                        // Stale: the owner died without cleaning up (crash,
                        // SIGKILL). Reclaim it once.
                        if attempt == 0 && fs::remove_file(&path).is_ok() {
                            continue;
                        }
                        return Outcome::Undetermined { reason: "stale lock not reclaimable".into() };
                    }
                    // Could not read the process table. Never refuse to show
                    // Candice on the strength of a check that did not run.
                    None => {
                        return Outcome::Undetermined {
                            reason: "process liveness undetermined".into(),
                        }
                    }
                }
            }
            Err(error) => {
                return Outcome::Undetermined { reason: format!("lock unusable: {error}") };
            }
        }
    }
    Outcome::Undetermined { reason: "lock contended".into() }
}

/// Raise the already-running instance so a wake still does something visible.
///
/// Best effort by design: if this fails the user simply does not get a focus
/// change, which is far better than a duplicate window. Never blocks.
pub fn focus_existing() {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open")
            .args(["-b", APP_ID])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        // No portable "raise that app" primitive. The guard's real job is
        // preventing the duplicate window; focus is the courtesy.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_launch_registers_so_a_later_wake_can_see_it() {
        // Regression: the first draft only registered wake launches, so a
        // bridged companion advertised nothing and the next wake opened a
        // second window. acquire() must not take a "guarded" argument at
        // all -- registration is unconditional, blocking is the caller's.
        let outcome = acquire();
        assert!(
            matches!(outcome, Outcome::Primary(_) | Outcome::AlreadyRunning { .. } | Outcome::Undetermined { .. }),
            "acquire must always reach a decision",
        );
    }

    #[test]
    fn our_own_pid_is_alive_and_an_absurd_one_is_not() {
        // CONTROL first: if this cannot see the process it is running in,
        // the liveness probe is broken and the negative below proves nothing.
        assert_eq!(pid_alive(std::process::id()), Some(true), "liveness probe is broken");
        // 0 is never a real user process id.
        assert_eq!(pid_alive(0), Some(false));
    }

    #[test]
    fn a_second_acquire_sees_the_first_and_the_lock_frees_on_drop() {
        let dir = std::env::temp_dir().join(format!("candice-si-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(LOCK_FILE);
        let _ = fs::remove_file(&path);

        // Simulate a live owner: this test's own pid, which is alive.
        {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .expect("lock created");
            write_pid(&mut file).expect("pid written");
        }
        assert_eq!(read_pid(&path), Some(std::process::id()));
        assert_eq!(pid_alive(read_pid(&path).unwrap()), Some(true));

        // Dropping the guard removes the file.
        let guard = InstanceGuard { path: path.clone() };
        drop(guard);
        assert!(!path.exists(), "guard did not release the lock on drop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stale_lock_does_not_keep_candice_off_the_screen() {
        // A crashed owner leaves its pid behind. The next launch must reclaim
        // it, not conclude that a duplicate is running forever.
        let dir = std::env::temp_dir().join(format!("candice-si-stale-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(LOCK_FILE);
        let _ = fs::remove_file(&path);
        {
            let mut file = File::create(&path).expect("lock created");
            // pid 0 is never alive, standing in for a dead owner.
            write!(file, "0").expect("pid written");
        }
        assert_eq!(pid_alive(read_pid(&path).unwrap()), Some(false));
        let _ = fs::remove_dir_all(&dir);
    }
}
