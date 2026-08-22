//! Anchor computation — where the companion window sits beside the bound
//! terminal (Master Spec 0E WS-21, section 17).
//!
//! The acceptance criterion (CHECKLIST E.1 WS-21) requires Candice to
//! "anchor beside Terminal.app and follow move/resize/minimize/monitor
//! changes". This module owns the *placement math*; the runtime (Tauri /
//! the integration lane) re-runs it whenever the window server reports a
//! change, and applies the resulting rectangle to the companion window.
//!
//! The anchor is a function of:
//!   - the terminal window's current global bounds,
//!   - the display frame the terminal is on,
//!   - the companion's own size,
//!   - a policy (side, gap, offset) plus the user's remembered offset.
//!
//! Global Quartz coordinates: origin at the top-left of the primary
//! display, y growing down (CGWindow bounds are already in that space).
//! Therefore "beside" on the right/left and "above/below" are straight
//! arithmetic on these rects — no flip confusion.
//!
//! User repositioning (spec 17 "allow user repositioning") is honored as
//! an explicit per-companion offset captured by the app and passed back
//! in; it is *not* a policy the runtime may write without user intent.

use crate::geometry::{PointLike, RectLike, ScaleHint};

/// Constants that *never* match real windows/IDs (used in defaults only).
const _NEVER_MATCHES: u32 = u32::MAX;

/// Which side of the terminal the companion prefers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AnchorSide {
    /// Right of the terminal (default: primary-dominant, matches the OS
    /// convention of trailing UI on the right).
    Right,
    Left,
    /// Above the terminal window's top edge (e.g. when the right edge is
    /// against the display frame).
    Top,
    Below,
}

/// Placement policy: the declared defaults plus remembered-offset math.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnchorPolicy {
    pub side: AnchorSide,
    /// Gap between terminal edge and companion edge, in logical points.
    pub gap: f64,
}

impl Default for AnchorPolicy {
    fn default() -> Self {
        AnchorPolicy {
            side: AnchorSide::Right,
            gap: 12.0,
        }
    }
}

/// The canonical defaults the runtime ships. Tests assert these exact
/// values; the app applies them unless the user has repositioned.
pub const DEFAULT_ANCHOR_POLICY: AnchorPolicy = AnchorPolicy {
    side: AnchorSide::Right,
    gap: 12.0,
};

/// The companion's own size, in logical points. The runtime knows the
/// real size; the anchor math needs it to compute the opposite edges.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompanionSize {
    pub width: f64,
    pub height: f64,
}

impl CompanionSize {
    pub fn new(width: f64, height: f64) -> Self {
        CompanionSize { width, height }
    }
    pub fn is_plausible(&self) -> bool {
        self.width > 0.0 && self.height > 0.0 && self.width < 100_000.0 && self.height < 100_000.0
    }
}

/// The rect the companion window should occupy. Global coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnchorRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl AnchorRect {
    pub fn to_rect_like(&self) -> RectLike {
        RectLike {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

/// A computed placement: the target rect plus which edge it was derived
/// from, so the runtime can log/diagnose policy decisions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnchorSpec {
    pub rect: AnchorRect,
    /// Which policy edge produced it (for audits; never a routing value).
    pub side: AnchorSide,
    /// False when the fallback (center of the terminal's display) was
    /// used because no side placement fit.
    pub is_fallback: bool,
}

/// Hard cap on terminal bounds the runtime should ever accept as input.
/// Guards against bogus window-server frames (0-sized or unbelievably
/// large rects) producing absurd anchors.
pub fn sanitize_terminal_bounds(b: &RectLike) -> Option<RectLike> {
    if b.width <= 0.0 || b.height <= 0.0 {
        return None;
    }
    if b.width > 100_000.0 || b.height > 100_000.0 || b.x.abs() > 1_000_000.0 || b.y.abs() > 1_000_000.0 {
        return None;
    }
    Some(*b)
}

/// Compute the anchor rect for the companion.
///
/// `user_offset` is the user's remembered repositioning delta in logical
/// points (x right, y down), applied on top of the policy placement. A
/// zero offset means "default placement" — the app persists the user's
/// own offset, never a computed one.
///
/// Placement algorithm:
///   1. `side` places the companion with its *near edge* `gap` points from
///      the terminal edge — right: companion.x = term.right() + gap;
///      left: companion.x = term.x - gap - companion.width; top/below
///      likewise on y.
///   2. When the resulting rect does not fit inside the terminal's display
///      frame, the opposite side is tried once; if that also fails the
///      fallback is the display frame's own center (always inside).
///   3. The user offset is then applied and *re-clamped* against the frame,
///      because a repositioned companion must never leave the visible
///      desktop (spec 17 "follow monitor changes").
pub fn compute_anchor(
    terminal: &RectLike,
    frame: &RectLike,
    companion: &CompanionSize,
    policy: Option<AnchorPolicy>,
    user_offset: PointLike,
    scale: ScaleHint,
) -> AnchorSpec {
    let term = sanitize_terminal_bounds(terminal);
    let frame_safe = sanitize_terminal_bounds(frame);
    let policy = policy.unwrap_or(DEFAULT_ANCHOR_POLICY);
    let (term, frame) = match (term, frame_safe) {
        (Some(t), Some(f)) => (t, f),
        _ => {
            // No sane input: center of the primary-ish frame at 0,0,0 size
            // is impossible — return a zero rect clearly marked fallback.
            return AnchorSpec {
                rect: AnchorRect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
                side: policy.side,
                is_fallback: true,
            };
        }
    };
    let w = (companion.width * scale.0).max(1.0);
    let h = (companion.height * scale.0).max(1.0);

    let try_side = |side: AnchorSide| -> Option<AnchorRect> {
        let (x, y) = match side {
            AnchorSide::Right => (term.right() + policy.gap, term.y),
            AnchorSide::Left => (term.x - policy.gap - w, term.y),
            AnchorSide::Top => (term.x, term.y - policy.gap - h),
            AnchorSide::Below => (term.x, term.bottom() + policy.gap),
        };
        let rect = AnchorRect { x, y, width: w, height: h };
        let fits = rect.x >= frame.x
            && rect.y >= frame.y
            && rect.x + rect.width <= frame.right()
            && rect.y + rect.height <= frame.bottom();
        fits.then_some(rect)
    };

    let placed = try_side(policy.side).or_else(|| try_side(opposite(policy.side)));
    let (mut rect, used_fallback) = match placed {
        Some(r) => (r, false),
        None => (
            AnchorRect {
                x: frame.mid_x() - w / 2.0,
                y: frame.mid_y() - h / 2.0,
                width: w,
                height: h,
            },
            true,
        ),
    };

    // Apply the user's remembered offset, then clamp into the frame.
    rect.x += user_offset.x * scale.0;
    rect.y += user_offset.y * scale.0;
    rect = clamp_into_frame(rect, &frame);

    AnchorSpec { rect, side: policy.side, is_fallback: used_fallback }
}

fn opposite(side: AnchorSide) -> AnchorSide {
    match side {
        AnchorSide::Right => AnchorSide::Left,
        AnchorSide::Left => AnchorSide::Right,
        AnchorSide::Top => AnchorSide::Below,
        AnchorSide::Below => AnchorSide::Top,
    }
}

fn clamp_into_frame(rect: AnchorRect, frame: &RectLike) -> AnchorRect {
    let mut x = rect.x;
    let mut y = rect.y;
    if x < frame.x {
        x = frame.x;
    }
    if y < frame.y {
        y = frame.y;
    }
    if x + rect.width > frame.right() {
        x = (frame.right() - rect.width).max(frame.x);
    }
    if y + rect.height > frame.bottom() {
        y = (frame.bottom() - rect.height).max(frame.y);
    }
    AnchorRect { x, y, width: rect.width, height: rect.height }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::RectLike;

    fn frame1440() -> RectLike {
        RectLike { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 }
    }
    fn term1200() -> RectLike {
        RectLike { x: 60.0, y: 80.0, width: 480.0, height: 700.0 }
    }
    fn companion() -> CompanionSize {
        CompanionSize::new(420.0, 640.0)
    }

    #[test]
    fn default_policy_places_companion_to_the_right() {
        let spec = compute_anchor(&term1200(), &frame1440(), &companion(), None, PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        let t = term1200();
        assert_eq!(spec.rect.x, t.right() + DEFAULT_ANCHOR_POLICY.gap);
        assert_eq!(spec.rect.y, t.y);
        assert_eq!(spec.side, AnchorSide::Right);
        assert!(!spec.is_fallback);
        // Fits inside the frame: 60+480+12+420 = 972 < 1440.
        assert!(spec.rect.x + spec.rect.width <= frame1440().right());
    }

    #[test]
    fn left_policy_is_mirrored() {
        // Terminal placed away from the left edge so LEFT has room.
        let t = RectLike { x: 500.0, y: 80.0, width: 480.0, height: 700.0 };
        let policy = AnchorPolicy { side: AnchorSide::Left, gap: 10.0 };
        let spec = compute_anchor(&t, &frame1440(), &companion(), Some(policy), PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert_eq!(spec.rect.x, t.x - 10.0 - 420.0);
        assert!(!spec.is_fallback);
    }

    #[test]
    fn top_and_below_work() {
        // Terminal low enough in the frame that TOP fits: y - 648 >= 0.
        let t = RectLike { x: 600.0, y: 700.0, width: 400.0, height: 150.0 };
        let f = frame1440();
        let policy = AnchorPolicy { side: AnchorSide::Top, gap: 8.0 };
        let spec = compute_anchor(&t, &f, &companion(), Some(policy), PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert_eq!(spec.rect.y, t.y - 8.0 - 640.0);
        assert_eq!(spec.rect.x, t.x);
        assert!(!spec.is_fallback);

        // BELOW fits when the frame is tall enough for
        // (terminal bottom + gap + companion height).
        let t2 = RectLike { x: 600.0, y: 100.0, width: 400.0, height: 200.0 };
        let tall = RectLike { x: 0.0, y: 0.0, width: 1440.0, height: 1200.0 };
        let policy = AnchorPolicy { side: AnchorSide::Below, gap: 8.0 };
        let spec = compute_anchor(&t2, &tall, &companion(), Some(policy), PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert_eq!(spec.rect.y, t2.bottom() + 8.0);
        assert_eq!(spec.rect.x, t2.x);
        assert!(!spec.is_fallback);
    }

    #[test]
    fn flips_to_opposite_side_when_no_room() {
        // Terminal against the right edge of the frame: right side has no room.
        let t = RectLike { x: 1000.0, y: 100.0, width: 440.0, height: 700.0 };
        let f = frame1440();
        let spec = compute_anchor(&t, &f, &companion(), None, PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert!(!spec.is_fallback);
        assert_eq!(spec.rect.x + spec.rect.width, t.x - DEFAULT_ANCHOR_POLICY.gap);
        assert!(spec.rect.x >= f.x);
    }

    #[test]
    fn fallback_centers_when_nothing_fits() {
        // Terminal fills the whole frame; no side fits.
        let t = frame1440();
        let f = frame1440();
        let spec = compute_anchor(&t, &f, &companion(), None, PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert!(spec.is_fallback);
        assert!((spec.rect.x - (f.mid_x() - 210.0)).abs() < 1e-9);
        assert!((spec.rect.y - (f.mid_y() - 320.0)).abs() < 1e-9);
    }

    #[test]
    fn user_offset_is_applied_then_clamped() {
        let f = frame1440();
        let spec = compute_anchor(&term1200(), &f, &companion(), None, PointLike { x: 200.0, y: -60.0 }, ScaleHint::default());
        let base = compute_anchor(&term1200(), &f, &companion(), None, PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert_eq!(spec.rect.x, base.rect.x + 200.0);
        assert_eq!(spec.rect.y, base.rect.y - 60.0);

        // Huge offset: must clamp back inside the frame.
        let spec = compute_anchor(&term1200(), &f, &companion(), None, PointLike { x: 10_000.0, y: 10_000.0 }, ScaleHint::default());
        assert!(spec.rect.x + spec.rect.width <= f.right() + 1e-9);
        assert!(spec.rect.y + spec.rect.height <= f.bottom() + 1e-9);
        assert!(spec.rect.x >= f.x);
        assert!(spec.rect.y >= f.y);
    }

    #[test]
    fn scale_hint_scales_companion_size() {
        let spec = compute_anchor(&term1200(), &frame1440(), &companion(), None, PointLike { x: 0.0, y: 0.0 }, ScaleHint(2.0));
        assert_eq!(spec.rect.width, 840.0);
        assert_eq!(spec.rect.height, 1280.0);
    }

    #[test]
    fn garbage_inputs_degrade_to_fallback_zero() {
        let bad = RectLike { x: 0.0, y: 0.0, width: 0.0, height: -5.0 };
        let spec = compute_anchor(&bad, &frame1440(), &companion(), None, PointLike { x: 0.0, y: 0.0 }, ScaleHint::default());
        assert!(spec.is_fallback);
        assert_eq!(spec.rect.width, 0.0);
    }

    #[test]
    fn sanitize_rejects_zero_and_huge() {
        assert!(sanitize_terminal_bounds(&RectLike { x: 0.0, y: 0.0, width: 0.0, height: 10.0 }).is_none());
        assert!(sanitize_terminal_bounds(&RectLike { x: 0.0, y: 0.0, width: 200_000.0, height: 10.0 }).is_none());
        assert!(sanitize_terminal_bounds(&RectLike { x: -2_000_000.0, y: 0.0, width: 100.0, height: 10.0 }).is_none());
        assert!(sanitize_terminal_bounds(&term1200()).is_some());
    }

    #[test]
    fn companion_size_plausibility() {
        assert!(CompanionSize::new(420.0, 640.0).is_plausible());
        assert!(!CompanionSize::new(0.0, 640.0).is_plausible());
        assert!(!CompanionSize::new(420.0, -1.0).is_plausible());
    }
}
