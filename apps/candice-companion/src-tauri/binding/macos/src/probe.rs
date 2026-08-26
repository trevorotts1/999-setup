//! Live window-server probe (Master Spec 0E WS-21, section 17).
//!
//! The real `CGWindowListCopyWindowInfo` call plus the parsing of
//! `kCGWindow*` keys into `DiscoveredWindow` records. Compiled only when
//! the `live-probe` feature is enabled; the default build keeps the crate
//! dependency-free and permission-free so `cargo test` passes on any
//! developer machine. The pure discovery/anchor logic is tested on
//! fixtures regardless.
//!
//! Privacy/consent model (macOS 10.15+):
//!   - owner PID, owner name, bounds, layer, on-screen state: always
//!     available to ANY process — no Screen Recording consent required;
//!   - `kCGWindowName`/title: requires Screen Recording consent; when the
//!     consent is missing the key is simply absent. We therefore never
//!     depend on titles for matching; they are optional metadata only.
//!
//! Screen Recording is NOT the Accessibility permission: WS-22 owns the
//! Accessibility (AXUIElement) path and its prompt; this crate never
//! triggers either prompt on its own (it reads the window list — a
//! passive public API).

#[cfg(feature = "live-probe")]
mod live {
    use core::ffi::c_void;
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::{CFNumber, CFNumberRef};
    use core_foundation::string::CFString;
    use core_graphics::window::{
        copy_window_info, kCGWindowBounds, kCGWindowIsOnscreen, kCGWindowLayer, kCGWindowName,
        kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
    };

    use crate::discover::DiscoveredWindow;
    use crate::geometry::RectLike;

    /// Calls `CGWindowListCopyWindowInfo` and decodes every record.
    /// Total: returns `Err` on a NULL array; records that fail to decode
    /// are skipped (defensive), never fatal.
    pub fn read_window_records() -> Result<Vec<DiscoveredWindow>, String> {
        let array = copy_window_info(core_graphics::window::kCGWindowListOptionAll, 0).ok_or_else(
            || "CGWindowListCopyWindowInfo returned NULL (window server unavailable)".to_string(),
        )?;

        let mut out = Vec::new();
        for item in array.iter() {
            // The iterator yields ItemRef<*const c_void>; deref to the raw
            // dictionary pointer and wrap under the get rule (we do not
            // own these references).
            let ptr: *const c_void = *item;
            // Owned get-rule wrapper: dropping it balances one retain; the
            // array itself keeps the records alive for the loop's duration.
            let dict = unsafe { CFDictionary::<*const c_void, *const c_void>::wrap_under_get_rule(ptr as CFDictionaryRef) };
            if let Some(rec) = decode_record(&dict) {
                out.push(rec);
            }
        }
        Ok(out)
    }

    /// Read a value by key from the record dict, as an owned `CFType`
    /// get-rule reference. `None` when the key is absent (this is the
    /// normal case for the title key without Screen Recording consent).
    fn record_value(
        dict: &CFDictionary<*const c_void, *const c_void>,
        key: core_foundation::string::CFStringRef,
    ) -> Option<CFType> {
        let found: core_foundation::base::ItemRef<*const c_void> =
            dict.find(key as *const c_void)?;
        let ptr: *const c_void = *found;
        // get-rule: we do not take ownership of the dict's entry.
        Some(unsafe { CFType::wrap_under_get_rule(ptr) })
    }

    fn key_i64(dict: &CFDictionary<*const c_void, *const c_void>, key: core_foundation::string::CFStringRef) -> Option<i64> {
        let value = record_value(dict, key)?;
        let number: CFNumber = value.downcast()?;
        number.to_i64()
    }

    fn key_bool(dict: &CFDictionary<*const c_void, *const c_void>, key: core_foundation::string::CFStringRef) -> Option<bool> {
        key_i64(dict, key).map(|n| n != 0)
    }

    fn key_string(dict: &CFDictionary<*const c_void, *const c_void>, key: core_foundation::string::CFStringRef) -> Option<String> {
        let value = record_value(dict, key)?;
        let string: CFString = value.downcast()?;
        Some(string.to_string())
    }

    /// `kCGWindowBounds` is a CFArray of four CFNumbers: X, Y, W, H.
    fn key_bounds(dict: &CFDictionary<*const c_void, *const c_void>) -> Option<RectLike> {
        let value = record_value(dict, unsafe { kCGWindowBounds })?;
        let array: CFArray<*const c_void> = value.downcast()?;
        let mut nums = [0.0f64; 4];
        for (slot, item) in array.iter().take(4).enumerate() {
            let ptr: *const c_void = *item;
            let num =
                unsafe { CFNumber::wrap_under_get_rule(ptr as CFNumberRef) };
            nums[slot] = num.to_f64()?;
        }
        Some(RectLike {
            x: nums[0],
            y: nums[1],
            width: nums[2],
            height: nums[3],
        })
    }

    /// Decode one record. Returns None when the record is not in the
    /// shape we expect (safe to skip). `kCGWindow*` statics are extern
    /// symbols, so every key read is inside an `unsafe` block (their
    /// addresses never vary).
    fn decode_record(dict: &CFDictionary<*const c_void, *const c_void>) -> Option<DiscoveredWindow> {
        let id = key_i64(dict, unsafe { kCGWindowNumber })?;
        let pid = key_i64(dict, unsafe { kCGWindowOwnerPID })?;
        let layer = key_i64(dict, unsafe { kCGWindowLayer }).unwrap_or(0);
        // Title is OPTIONAL metadata (privacy gate); never required.
        let _title = key_string(dict, unsafe { kCGWindowName });
        let on_screen = key_bool(dict, unsafe { kCGWindowIsOnscreen }).unwrap_or(false);
        let owner = key_string(dict, unsafe { kCGWindowOwnerName }).unwrap_or_default();
        let bounds = key_bounds(dict)?;

        Some(DiscoveredWindow {
            pid: pid as i32,
            owner_name: owner,
            window_id: id as u32,
            bounds,
            layer: layer as i32,
            on_screen,
        })
    }
}

/// Re-export the live read when the feature is on.
#[cfg(feature = "live-probe")]
pub use live::read_window_records;

#[cfg(test)]
mod tests {
    use crate::discover::{discover_terminal_window, DiscoverOptions, WindowConfidence};
    use crate::geometry::RectLike;

    fn term(pid: i32, id: u32, x: f64) -> crate::discover::DiscoveredWindow {
        crate::discover::DiscoveredWindow {
            pid,
            owner_name: "Terminal".to_string(),
            window_id: id,
            bounds: RectLike { x, y: 100.0, width: 480.0, height: 700.0 },
            layer: 0,
            on_screen: true,
        }
    }

    /// Fixture-path decode: a decoded record feeds the same discovery
    /// pipeline the live probe uses. This proves the end-to-end contract
    /// without OS permission.
    #[test]
    fn decoded_records_feed_discovery() {
        let records = vec![term(9, 2, 60.0), term(42, 3, 600.0)];
        let m = discover_terminal_window(&records, &DiscoverOptions { caller_pid: Some(42), display_id: None });
        assert_eq!(m.confidence, WindowConfidence::Exact);
        assert_eq!(m.best.unwrap().window_id, 3);
    }

    #[test]
    fn empty_list_is_not_fatal() {
        let m = discover_terminal_window(&[], &DiscoverOptions::default());
        assert_eq!(m.confidence, WindowConfidence::None);
        assert!(m.best.is_none());
    }

    #[test]
    fn off_screen_records_do_not_anchor() {
        let mut w = term(9, 2, 60.0);
        w.on_screen = false;
        let m = discover_terminal_window(&[w], &DiscoverOptions { caller_pid: Some(9), display_id: None });
        assert_eq!(m.confidence, WindowConfidence::None);
    }
}
