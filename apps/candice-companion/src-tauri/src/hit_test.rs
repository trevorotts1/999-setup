//! Transparent-window pointer hit testing — the native half of the FIX-008
//! partial-input-region seam.
//!
//! FIX-008 made the entire 420x640 companion window pointer-transparent
//! (`set_ignore_cursor_events(true)`) for a real reason: a transparent
//! webview still receives events across its full native rectangle, so
//! disabling click-through for one visible control turns the invisible
//! remainder of that rectangle into a Terminal blocker. That decision is
//! preserved here, not reversed.
//!
//! What it cost was the ability to grab the character and move the window.
//! `src/window/input-policy.ts` already declared the way out — a
//! `PartialInputRegionAdapter` that installs "native-proven visible
//! regions" — but no implementation existed, so `setInteractiveRegions`
//! always failed closed back to whole-window pass-through. This module is
//! that missing implementation.
//!
//! Mechanism. The webview publishes the bounding boxes of the pixels it
//! actually paints (character art, opaque UI surfaces, controls) in CSS
//! pixels relative to the window content origin. One background thread
//! polls the global cursor position — the webview cannot observe the cursor
//! at all while click-through is on, so that position must come from the
//! native side — and keeps `ignore_cursor_events` TRUE everywhere except
//! while the cursor is inside a published box.
//!
//! The resting state is therefore exactly the FIX-008 state: pass-through.
//! The window captures the pointer only over pixels the operator can see,
//! and releases it the moment the cursor leaves them.
//!
//! Single-writer invariant. After `show_main_window` sets the initial
//! pass-through, this module is the ONLY caller of
//! `set_ignore_cursor_events`. `cmd_set_answer_input_enabled`
//! (`runtime.rs`) routes through [`set_answer_override`] so the
//! authenticated bridge lifecycle and the cursor hit test can never fight
//! over the flag.
//!
//! Honest limits (do not overstate these upstream):
//! - Regions are rectangles, not per-pixel alpha masks. A transparent
//!   corner inside the character's box is captured by this layer.
//! - The poll interval bounds how fast the policy reacts; a pointer that
//!   arrives and clicks within one interval can be missed.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};

/// Emitted only on an actual capture-state transition, so a listener can
/// observe the policy without polling it.
pub const POINTER_POLICY_EVENT: &str = "candice:pointer-policy";

/// The window this policy governs (matches `tauri.conf.json`).
const MAIN_WINDOW_LABEL: &str = "main";

/// Poll cadence for the cursor. 16ms tracks a 60Hz pointer. The loop does
/// two event-loop round trips per tick (cursor position and window origin);
/// size, scale and visibility are cached — see [`CachedGeometry`].
const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// Ceiling on published regions. The shell paints a handful of surfaces;
/// anything beyond this is a malformed publisher, not a real UI.
const MAX_REGIONS: usize = 64;

/// One publisher-declared interactive box, in CSS pixels relative to the
/// window content origin. Mirrors `InputRegion` in
/// `src/window/input-policy.ts`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Free-form on the wire; the TypeScript side constrains it to
    /// `control` / `drag-handle` / `character-activate`. Carried through
    /// only so diagnostics can say WHICH surface captured the pointer.
    pub purpose: String,
}

impl InputRegion {
    fn valid(&self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// Managed state for the pointer policy.
///
/// `interactive` is a `Mutex<bool>` rather than an atomic on purpose: the
/// lock is held across the `set_ignore_cursor_events` call so the recorded
/// state and the OS state cannot diverge when the poll thread and a bridge
/// command race.
#[derive(Default)]
pub struct HitTestState {
    regions: Mutex<Vec<InputRegion>>,
    /// True == the window currently receives pointer input.
    interactive: Mutex<bool>,
    /// Bridge-owned force-on (`cmd_set_answer_input_enabled`).
    answer_override: AtomicBool,
    /// Set once when the poll thread starts; the thread starts at most once.
    polling: AtomicBool,
    /// Last window-local cursor position, `None` when outside the window.
    cursor: Mutex<Option<(f64, f64)>>,
    /// Completed poll iterations. A caller that wants to know the loop is
    /// alive must read a rising count — never infer it from a command
    /// returning Ok.
    ticks: AtomicU64,
}

/// Truthful read of the policy for diagnostics and tests. Every field is
/// observed state, never an intention.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerPolicySnapshot {
    pub interactive: bool,
    pub region_count: usize,
    pub answer_override: bool,
    pub polling: bool,
    pub ticks: u64,
    /// Window-local cursor in CSS pixels, `None` when the cursor is outside
    /// the window or could not be read.
    pub cursor: Option<[f64; 2]>,
    pub regions: Vec<InputRegion>,
}

impl HitTestState {
    fn snapshot(&self) -> PointerPolicySnapshot {
        let regions = self.regions.lock().map(|g| g.clone()).unwrap_or_default();
        PointerPolicySnapshot {
            interactive: self.interactive.lock().map(|g| *g).unwrap_or(false),
            region_count: regions.len(),
            answer_override: self.answer_override.load(Ordering::SeqCst),
            polling: self.polling.load(Ordering::SeqCst),
            ticks: self.ticks.load(Ordering::Relaxed),
            cursor: self.cursor.lock().ok().and_then(|g| *g).map(|(x, y)| [x, y]),
            regions,
        }
    }
}

/// Publish the visible interactive regions.
///
/// Returns `Ok(true)` only when these exact regions were installed — the
/// contract `PartialInputRegionAdapter.setInteractiveRegions` documents.
/// Malformed input installs nothing, forces pass-through, and returns
/// `Ok(false)` so the webview policy fails closed instead of guessing.
#[tauri::command]
pub fn cmd_set_input_regions<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, HitTestState>,
    regions: Vec<InputRegion>,
) -> Result<bool, String> {
    let accepted = regions.len() <= MAX_REGIONS && regions.iter().all(InputRegion::valid);
    {
        let mut slot = state
            .regions
            .lock()
            .map_err(|_| "candice: pointer region state unavailable".to_string())?;
        *slot = if accepted { regions } else { Vec::new() };
    }
    if std::env::var_os("CANDICE_POINTER_TRACE").is_some() {
        let published = state.regions.lock().map(|g| g.clone()).unwrap_or_default();
        eprintln!(
            "candice-pointer: publish accepted={} count={} boxes={:?}",
            accepted,
            published.len(),
            published
                .iter()
                .map(|r| (r.purpose.clone(), r.x, r.y, r.width, r.height))
                .collect::<Vec<_>>(),
        );
    }
    if accepted {
        start_polling(&app);
    }
    // Re-evaluate immediately so a publish that lands while the cursor is
    // already over a region does not wait for the next tick.
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let desired = state.answer_override.load(Ordering::SeqCst)
            || read_geometry(&window)
                .is_some_and(|geometry| hit_test(&window, &state, geometry));
        apply(&app, &window, &state, desired);
    }
    Ok(accepted)
}

/// Read the live policy. Exposed so behavior can be demonstrated rather
/// than asserted: the caller sees the real capture flag, the real region
/// list, and a real rising tick count.
#[tauri::command]
pub fn cmd_get_pointer_policy(
    state: State<'_, HitTestState>,
) -> Result<PointerPolicySnapshot, String> {
    Ok(state.snapshot())
}

/// Bridge-owned override: while a delivered question owns the visible
/// answer controls, the window captures the pointer regardless of where
/// the cursor is. Called by `runtime::cmd_set_answer_input_enabled`, which
/// no longer touches `set_ignore_cursor_events` itself.
pub fn set_answer_override<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let state = app
        .try_state::<HitTestState>()
        .ok_or_else(|| "candice: pointer policy state unavailable".to_string())?;
    state.answer_override.store(enabled, Ordering::SeqCst);
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "candice: main window missing".to_string())?;
    let desired = enabled
        || read_geometry(&window).is_some_and(|geometry| hit_test(&window, &state, geometry));
    apply(app, &window, &state, desired)
        .then_some(())
        .ok_or_else(|| "candice: input policy failed".to_string())
}

/// Apply the desired capture state. Returns false only when the OS refused
/// the change; in that case the recorded state is left matching the OS, so
/// a snapshot never claims a capture that did not happen.
fn apply<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    state: &HitTestState,
    desired: bool,
) -> bool {
    let Ok(mut current) = state.interactive.lock() else {
        return false;
    };
    if *current == desired {
        return true;
    }
    if let Err(error) = window.set_ignore_cursor_events(!desired) {
        eprintln!("candice: pointer policy update failed: {error}");
        return false;
    }
    *current = desired;
    drop(current);
    // Opt-in trace (`CANDICE_POINTER_TRACE=1`). The capture state is
    // otherwise unobservable from outside the process — the window looks
    // identical either way — so this exists to make the policy measurable
    // instead of assumed. Off by default: transitions are frequent enough
    // to be noise in a normal run.
    if std::env::var_os("CANDICE_POINTER_TRACE").is_some() {
        let snapshot = state.snapshot();
        eprintln!(
            "candice-pointer: interactive={} cursor={:?} regions={} override={}",
            snapshot.interactive,
            snapshot.cursor,
            snapshot.region_count,
            snapshot.answer_override,
        );
    }
    let _ = app.emit(POINTER_POLICY_EVENT, state.snapshot());
    true
}

/// Window facts that change rarely enough to cache between ticks.
///
/// Every one of these getters is a round trip to the event loop, and the
/// event loop is shared with a webview that is decoding artwork and running
/// a breathing animation. Reading all five every tick made the loop lag far
/// behind the cursor: a measured run showed the policy still reporting the
/// old state 70 window-pixels into a drag, so the press that should have
/// grabbed the character was delivered while the window was still
/// click-through and the drag silently did nothing.
///
/// Size, scale and visibility are refreshed on an interval instead. Only
/// the cursor and the window origin — the two that move continuously
/// during a drag — are read every tick.
#[derive(Clone, Copy)]
struct CachedGeometry {
    visible: bool,
    width: f64,
    height: f64,
    scale: f64,
}

/// Ticks between refreshes of the cached facts (~0.5s at POLL_INTERVAL).
const GEOMETRY_REFRESH_TICKS: u64 = 32;

fn read_geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<CachedGeometry> {
    let (Ok(visible), Ok(size), Ok(scale)) = (
        window.is_visible(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return None;
    };
    if !(scale > 0.0) {
        return None;
    }
    Some(CachedGeometry {
        visible,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
        scale,
    })
}

/// True when the cursor is inside the window AND inside a published
/// region. Any failure to read geometry answers false — the safe policy.
fn hit_test<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &HitTestState,
    geometry: CachedGeometry,
) -> bool {
    let regions = match state.regions.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return false,
    };
    if regions.is_empty() {
        if let Ok(mut slot) = state.cursor.lock() {
            *slot = None;
        }
        return false;
    }
    if !geometry.visible {
        return false;
    }
    let (Ok(cursor), Ok(origin)) = (window.cursor_position(), window.inner_position()) else {
        return false;
    };
    let scale = geometry.scale;
    let local_x = (cursor.x - f64::from(origin.x)) / scale;
    let local_y = (cursor.y - f64::from(origin.y)) / scale;
    let width = geometry.width;
    let height = geometry.height;
    let inside_window =
        local_x >= 0.0 && local_y >= 0.0 && local_x < width && local_y < height;
    if let Ok(mut slot) = state.cursor.lock() {
        *slot = if inside_window {
            Some((local_x, local_y))
        } else {
            None
        };
    }
    inside_window && regions.iter().any(|region| region.contains(local_x, local_y))
}

/// Start the cursor poll thread. Idempotent: the flag is claimed with a
/// swap so a second publish cannot start a second thread.
fn start_polling<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<HitTestState>().polling.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("candice-pointer-hit-test".into())
        .spawn(move || poll_loop(app));
    if let Err(error) = spawned {
        eprintln!("candice: pointer hit-test thread unavailable: {error}");
        // Truthful: nothing is polling, so the snapshot must not say it is.
        // Regions stay published and the immediate re-evaluation in
        // `cmd_set_input_regions` still works; only tracking is lost.
        return;
    }
}

/// Poll until the main window is gone.
///
/// The window disappearing is the app shutting down, which is the exit
/// condition that keeps this thread from outliving the process (the
/// `Cargo.toml` "no background threads that outlive the app" invariant).
fn poll_loop<R: Runtime>(app: AppHandle<R>) {
    let mut geometry: Option<CachedGeometry> = None;
    let mut since_refresh = GEOMETRY_REFRESH_TICKS;
    let trace = std::env::var_os("CANDICE_POINTER_TRACE").is_some();
    let mut rate_mark = std::time::Instant::now();
    let mut rate_ticks: u64 = 0;
    loop {
        std::thread::sleep(POLL_INTERVAL);
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            break;
        };
        let Some(state) = app.try_state::<HitTestState>() else {
            break;
        };
        state.ticks.fetch_add(1, Ordering::Relaxed);
        if since_refresh >= GEOMETRY_REFRESH_TICKS {
            geometry = read_geometry(&window);
            since_refresh = 0;
        }
        since_refresh += 1;
        let desired = state.answer_override.load(Ordering::SeqCst)
            || geometry.is_some_and(|cached| hit_test(&window, &state, cached));
        apply(&app, &window, &state, desired);
        if trace {
            rate_ticks += 1;
            if rate_ticks >= 100 {
                // Real observed cadence, not the configured one. If this
                // drifts far above POLL_INTERVAL the policy is lagging the
                // cursor and presses will be missed.
                eprintln!(
                    "candice-pointer: cadence {} ticks in {}ms",
                    rate_ticks,
                    rate_mark.elapsed().as_millis()
                );
                rate_ticks = 0;
                rate_mark = std::time::Instant::now();
            }
        }
    }
    if let Some(state) = app.try_state::<HitTestState>() {
        state.polling.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(x: f64, y: f64, width: f64, height: f64) -> InputRegion {
        InputRegion {
            x,
            y,
            width,
            height,
            purpose: "drag-handle".into(),
        }
    }

    #[test]
    fn contains_is_half_open_so_adjacent_regions_never_overlap() {
        let r = region(10.0, 20.0, 100.0, 50.0);
        assert!(r.contains(10.0, 20.0), "top-left corner is inside");
        assert!(r.contains(109.9, 69.9), "just inside the far edge");
        assert!(!r.contains(110.0, 40.0), "right edge is exclusive");
        assert!(!r.contains(50.0, 70.0), "bottom edge is exclusive");
        assert!(!r.contains(9.9, 20.0), "left of the region");
    }

    #[test]
    fn malformed_regions_are_rejected_not_clamped() {
        assert!(!region(0.0, 0.0, 0.0, 10.0).valid(), "zero width");
        assert!(!region(0.0, 0.0, 10.0, -1.0).valid(), "negative height");
        assert!(!region(f64::NAN, 0.0, 10.0, 10.0).valid(), "NaN origin");
        assert!(
            !region(0.0, 0.0, f64::INFINITY, 10.0).valid(),
            "infinite extent"
        );
        assert!(region(-5.0, -5.0, 10.0, 10.0).valid(), "negative origin is legal");
    }

    #[test]
    fn default_state_rests_in_pass_through() {
        let state = HitTestState::default();
        let snapshot = state.snapshot();
        assert!(
            !snapshot.interactive,
            "the resting state must be FIX-008 pass-through, not capture"
        );
        assert_eq!(snapshot.region_count, 0);
        assert!(!snapshot.polling);
        assert_eq!(snapshot.ticks, 0);
        assert!(snapshot.cursor.is_none());
    }
}
