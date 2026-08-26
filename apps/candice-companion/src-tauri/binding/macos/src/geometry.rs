//! Minimal geometry surface — pure value types, no CoreGraphics linkage
//! in the default build (WS-21).
//!
//! The real CGRect/CGPoint/CGSize live behind the `live-probe` feature;
//! tests and the anchoring math (which is what the acceptance criterion
//! exercises) operate on these plain structs. Conversions accept the
//! four fields CoreGraphics rectangles expose — this keeps the crate
//! independently testable without opening a window-server connection,
//! and keeps the surface small enough that the anchor math is provable
//! in isolation.

/// One rectangle in global (Quartz) coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RectLike {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One point in global (Quartz) coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointLike {
    pub x: f64,
    pub y: f64,
}

/// A display identifier. `u32` matches `CGDirectDisplayID`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayId(pub u32);

/// Anything CoreGraphics-shaped enough to convert into `RectLike`:
/// `CGRect` exposes `.origin.x`, `.origin.y`, `.size.width`,
/// `.size.height` (which is exactly the four fields RectLike carries).
pub trait CgRectLike {
    fn origin_x(&self) -> f64;
    fn origin_y(&self) -> f64;
    fn width(&self) -> f64;
    fn height(&self) -> f64;
}

impl CgRectLike for RectLike {
    fn origin_x(&self) -> f64 {
        self.x
    }
    fn origin_y(&self) -> f64 {
        self.y
    }
    fn width(&self) -> f64 {
        self.width
    }
    fn height(&self) -> f64 {
        self.height
    }
}

impl RectLike {
    pub fn right(&self) -> f64 {
        self.x + self.width
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }
    pub fn mid_x(&self) -> f64 {
        self.x + self.width / 2.0
    }
    pub fn mid_y(&self) -> f64 {
        self.y + self.height / 2.0
    }
    pub fn center(&self) -> PointLike {
        PointLike {
            x: self.mid_x(),
            y: self.mid_y(),
        }
    }
    /// Midpoint of the window's top edge — the classic anchor point for a
    /// companion that sits beside the terminal.
    pub fn top_center(&self) -> PointLike {
        PointLike {
            x: self.mid_x(),
            y: self.y,
        }
    }
    /// Does this rect contain the point (inclusive of edges)?
    pub fn contains(&self, p: PointLike) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }

    /// Global-coordinate transform into a local frame (monitor-space).
    pub fn offset_from(&self, frame: &RectLike) -> RectLike {
        RectLike {
            x: self.x - frame.x,
            y: self.y - frame.y,
            width: self.width,
            height: self.height,
        }
    }
}

impl Default for RectLike {
    fn default() -> Self {
        RectLike {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        }
    }
}

/// Scale hint for matching CoreGraphics points to logical (UI) points.
/// On Retina the window-server bounds are already in points, so the
/// default is `1.0`; a caller that reads pixel offsets instead may pass
/// its actual scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScaleHint(pub f64);

impl Default for ScaleHint {
    fn default() -> Self {
        ScaleHint(1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_accessors_are_correct() {
        let r = RectLike {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
        };
        assert_eq!(r.right(), 110.0);
        assert_eq!(r.bottom(), 70.0);
        assert_eq!(r.mid_x(), 60.0);
        assert_eq!(r.mid_y(), 45.0);
        assert_eq!(r.center(), PointLike { x: 60.0, y: 45.0 });
        assert_eq!(r.top_center(), PointLike { x: 60.0, y: 20.0 });
    }

    #[test]
    fn contains_is_inclusive_on_edges() {
        let r = RectLike {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        };
        assert!(r.contains(PointLike { x: 0.0, y: 0.0 }));
        assert!(r.contains(PointLike { x: 100.0, y: 100.0 }));
        assert!(!r.contains(PointLike { x: 100.5, y: 50.0 }));
    }

    #[test]
    fn offset_from_shifts_into_local_frame() {
        let frame = RectLike {
            x: 100.0,
            y: 200.0,
            width: 1440.0,
            height: 900.0,
        };
        let win = RectLike {
            x: 300.0,
            y: 250.0,
            width: 400.0,
            height: 300.0,
        };
        assert_eq!(
            win.offset_from(&frame),
            RectLike {
                x: 200.0,
                y: 50.0,
                width: 400.0,
                height: 300.0
            }
        );
    }

    #[test]
    fn cgrect_like_impl_roundtrips() {
        let r = RectLike {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        };
        assert_eq!(r.origin_x(), 1.0);
        assert_eq!(r.origin_y(), 2.0);
        assert_eq!(r.width(), 3.0);
        assert_eq!(r.height(), 4.0);
    }
}
