//! Anchor placement for the companion beside the bound host window (WS-26).
//!
//! Pure geometry: given the host window rect, the companion size, and the
//! monitor work area, produce the companion's target rect. Never touches a
//! window; the caller applies the rect. Follow-move/follow-resize behavior
//! = re-running `anchor_for_window` on each host-window geometry change.

#![forbid(unsafe_code)]

use crate::model::{Anchor, AnchorSide, HostWindow, Rect};

/// Companion margin defaults (logical px).
pub const DEFAULT_GAP_PX: u32 = 12;
pub const DEFAULT_SIDE: AnchorSide = AnchorSide::Right;

/// Memory of the last user-chosen side per window; the user may reposition
/// (spec 17: allow user repositioning, remember preferred offset).
#[derive(Clone, Debug)]
pub struct AnchorPlanner {
    pub preferred_side: AnchorSide,
    pub preferred_gap_px: u32,
}

impl Default for AnchorPlanner {
    fn default() -> Self {
        AnchorPlanner {
            preferred_side: DEFAULT_SIDE,
            preferred_gap_px: DEFAULT_GAP_PX,
        }
    }
}

impl AnchorPlanner {
    /// Compute the companion rect anchored at the given side of the host
    /// window, clamped into the work area (keep the companion fully visible;
    /// if the monitor is smaller than the companion, top-left is used).
    ///
    /// All rects are in the same coordinate space (logical DIPs).
    pub fn anchor(&self, host: &HostWindow, companion_w: u32, companion_h: u32) -> Rect {
        anchor_for_window(
            &host.rect,
            &host.monitor_work_area,
            self.preferred_side,
            self.preferred_gap_px,
            companion_w,
            companion_h,
        )
    }

    /// Anchor descriptor for the renderer (window id + side + scale).
    pub fn anchor_descriptor(&self, host: &HostWindow) -> Anchor {
        Anchor {
            window_id: host.id,
            side: self.preferred_side,
            gap_px: self.preferred_gap_px,
            dpi_scale: host.dpi as f64 / 96.0,
        }
    }
}

/// Pure anchor computation (also exported standalone for tests/callers that
/// only have rects).
pub fn anchor_for_window(
    host: &Rect,
    work_area: &Rect,
    side: AnchorSide,
    gap_px: u32,
    companion_w: u32,
    companion_h: u32,
) -> Rect {
    let gap = gap_px as i32;
    let cw = companion_w as i32;
    let ch = companion_h as i32;

    let raw = match side {
        AnchorSide::Right => Rect {
            left: host.right() + gap,
            top: host.top,
            width: companion_w,
            height: companion_h,
        },
        AnchorSide::Left => Rect {
            left: host.left - gap - cw,
            top: host.top,
            width: companion_w,
            height: companion_h,
        },
        AnchorSide::Top => Rect {
            left: host.left,
            top: host.top - gap - ch,
            width: companion_w,
            height: companion_h,
        },
        AnchorSide::Bottom => Rect {
            left: host.left,
            top: host.bottom() + gap,
            width: companion_w,
            height: companion_h,
        },
    };

    clamp_into(raw, work_area)
}

/// Clamp a rect into the work area: shift it so it sits fully inside; if the
/// work area is smaller than the rect in a dimension, align its origin edge.
pub fn clamp_into(rect: Rect, work: &Rect) -> Rect {
    if work.is_empty() {
        return rect;
    }
    let mut r = rect;
    let w = r.width as i32;
    let h = r.height as i32;

    if r.left < work.left {
        r.left = work.left;
    } else if r.right() > work.right() && w <= work.width as i32 {
        r.left = work.right() - w;
    } else if r.right() > work.right() {
        r.left = work.left;
    }

    if w > work.width as i32 {
        r.left = work.left;
        r.width = work.width;
    }
    if h > work.height as i32 {
        r.top = work.top;
        r.height = work.height;
    }

    if r.top < work.top {
        r.top = work.top;
    } else if r.bottom() > work.bottom() && h <= work.height as i32 {
        r.top = work.bottom() - h;
    } else if r.bottom() > work.bottom() {
        r.top = work.top;
    }

    r
}
