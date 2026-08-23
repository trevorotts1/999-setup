//! Installer-managed verified asset directory (QFIX Q-05, q2-design.md
//! section 5 — the binding asset-delivery decision for this fix lane).
//!
//! Decision: the app bundle carries only the approval manifest
//! (`SPEECH-INVENTORY.json` via `bundle.resources`); every payload
//! artifact (STT model/binary, TTS model/voices/worker, Python runtime)
//! is delivered by the existing FIX-018 installer lane into a per-user
//! verified directory, checksum-verified before placement, with a
//! provenance receipt recorded next to the assets.
//!
//! Resolution order (design 5.2), first hit wins per entry:
//!   1. `CANDICE_SPEECH_ASSETS` env override (operator/testing);
//!   2. per-user verified dir:
//!      macOS   `~/Library/Application Support/com.blackceo.candice/speech-assets`
//!      Windows `%APPDATA%\com.blackceo.candice\speech-assets`
//!   3. bundled resource dir (`resource_dir()/speech-assets` — the
//!      manifest and any future small assets).
//!
//! Checksum authority (design 5.4): the inventory's sha256 values are
//! the only accepted values; `cmd_speech_health` reports the pin and the
//! on-disk measured hash, and a mismatch is degraded with a precise
//! reason — never silent.
//!
//! Provenance (design 5.5): the installer records source URL + sha256 +
//! placement timestamp per artifact in `asset-receipt.json` next to the
//! verified directory. This module defines the receipt schema and
//! writes receipts for tests and the post-Q-05 installer work to share;
//! the health command reports receipt presence.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

/// Inventory artifact path segments. The generator's `path` arrays are
/// joined and emitted as `installPath` (relative to the asset root) in
/// `SPEECH-INVENTORY.json`; entries that never received a path resolve
/// to the legacy `speech-assets/<dir>/<filename>` layout.
const LEGACY_DIRS: &[(&str, &str)] = &[
    ("stt-model", "stt"),
    ("stt-binary-macos", "stt"),
    ("stt-binary-windows-x64", "stt"),
    ("stt-binary-windows-win32", "stt"),
    ("tts-model", "tts/runtime"),
    ("tts-voices", "tts/runtime"),
    ("tts-worker", "tts/runtime"),
    ("tts-runtime-pins", "tts/runtime"),
];

/// One inventory artifact row (QFIX Q-05 schema v2). The generator emits
/// camelCase keys (`sourceUrl`, `sha256Status`); rename keeps the Rust
/// fields snake_case without drift.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryEntry {
    pub id: String,
    pub filename: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub sha256_status: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub bundled: Option<bool>,
    /// QFIX Q-05: relative path inside the asset root (v2 generator).
    #[serde(default)]
    pub install_path: Option<String>,
}

/// The machine-readable manifest (truth source, design 5.1). The
/// generator emits camelCase keys (`generatedBy`, `bundleRoot`,
/// `canonicalVoice`, `pythonRuntime`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRecord {
    pub schema: String,
    #[serde(default)]
    pub generated_by: Option<String>,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub bundle_root: Option<String>,
    #[serde(default)]
    pub canonical_voice: Option<serde_json::Value>,
    #[serde(default)]
    pub python_runtime: Option<serde_json::Value>,
    #[serde(default)]
    pub entries: Vec<InventoryEntry>,
}

impl InventoryEntry {
    /// Path of this artifact relative to a candidate asset root.
    pub fn relative_path(&self) -> std::path::PathBuf {
        if let Some(install) = self.install_path.as_ref().filter(|p| !p.is_empty()) {
            return std::path::PathBuf::from(install);
        }
        for (id, dir) in LEGACY_DIRS {
            if self.id == *id {
                return std::path::PathBuf::from(*dir).join(&self.filename);
            }
        }
        std::path::PathBuf::from(&self.filename)
    }
}

/// One provenance receipt row (design 5.5): source URL + accepted sha256
/// + placement timestamp, written by the installer next to the assets.
/// The production writer is the post-Q-05 installer lane; today this is
/// exercised by the unit tests and read indirectly by health
/// (`receiptPresent`).
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReceiptRow {
    pub id: String,
    pub filename: String,
    pub sha256: String,
    pub source_url: String,
    /// RFC 3339 placement timestamp.
    pub placed_at: String,
}

/// The receipt document (schema v1). Lives at
/// `<verified-dir>/asset-receipt.json`. See [`ReceiptRow`] for the
/// production-consumer note.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReceiptRecord {
    pub schema: String,
    #[serde(default)]
    pub generated_by: Option<String>,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub entries: Vec<ReceiptRow>,
}

/// Fixed receipt filename next to the verified directory.
pub const RECEIPT_FILENAME: &str = "asset-receipt.json";

/// Asset resolution result: candidate roots in authority order plus the
/// inventory text read from the first root that carries it.
#[derive(Clone, Debug)]
pub struct AssetResolution {
    pub env_root: Option<std::path::PathBuf>,
    pub user_root: Option<std::path::PathBuf>,
    pub bundle_root: Option<std::path::PathBuf>,
    pub inventory_text: Option<String>,
}

impl AssetResolution {
    /// The root that supplies this entry, or None (artifact absent).
    pub fn root_for(&self, entry: &InventoryEntry) -> Option<std::path::PathBuf> {
        for root in self.candidates() {
            let candidate = root.join(entry.relative_path());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    }

    /// Candidate roots in resolution order: env, per-user verified dir,
    /// bundled resource dir.
    pub fn candidates(&self) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        if let Some(r) = &self.env_root {
            out.push(r.clone());
        }
        if let Some(r) = &self.user_root {
            out.push(r.clone());
        }
        if let Some(r) = &self.bundle_root {
            out.push(r.clone());
        }
        out
    }

    /// The installer provenance receipt path (design 5.5): written next
    /// to the verified directory — the per-user root when the app has an
    /// app-data dir, the env override root otherwise. Never points at
    /// the read-only bundle.
    pub fn receipt_path(&self) -> Option<std::path::PathBuf> {
        self.user_root
            .as_ref()
            .or(self.env_root.as_ref())
            .map(|root| root.join(RECEIPT_FILENAME))
    }
}

/// Resolve the asset delivery layout for this app (design 5.2 order).
pub fn resolve_speech_assets<R: Runtime>(app: &AppHandle<R>) -> AssetResolution {
    let env_root = std::env::var_os("CANDICE_SPEECH_ASSETS")
        .map(|v| std::path::PathBuf::from(v));
    let user_root = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("speech-assets"));
    let bundle_root = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("speech-assets"));

    let mut inventory_text: Option<String> = None;
    for root in [env_root.as_ref(), user_root.as_ref(), bundle_root.as_ref()]
        .into_iter()
        .flatten()
    {
        let manifest = root.join("SPEECH-INVENTORY.json");
        if let Ok(text) = std::fs::read_to_string(&manifest) {
            inventory_text = Some(text);
            break;
        }
    }

    AssetResolution {
        env_root,
        user_root,
        bundle_root,
        inventory_text,
    }
}

/// SHA-256 of a file (lowercase hex), the only accepted checksum form.
pub fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read failed: {e}"))?;
    let digest = Sha256::digest(&bytes);
    Ok(format!("{digest:x}"))
}

/// Write a provenance receipt for a set of verified artifacts. Used by
/// tests and by the post-Q-05 installer lane (which verifies SHA-256
/// before placement per design 5.2). Atomic: temp file + rename.
#[allow(dead_code)]
pub fn write_receipt(
    root: &std::path::Path,
    rows: &[ReceiptRow],
    generated_by: &str,
) -> Result<std::path::PathBuf, String> {
    if !root.is_dir() {
        return Err(format!(
            "receipt root is not a directory: {}",
            root.display()
        ));
    }
    let record = ReceiptRecord {
        schema: "candice.speech-asset-receipt/v1".into(),
        generated_by: Some(generated_by.into()),
        generated_at: Some(now_rfc3339()),
        entries: rows.to_vec(),
    };
    let text = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("receipt serialization failed: {e}"))?;
    let path = root.join(RECEIPT_FILENAME);
    let tmp = root.join(format!("{RECEIPT_FILENAME}.tmp"));
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("receipt write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("receipt rename failed: {e}"))?;
    Ok(path)
}

/// All artifact candidates for the platform (health/installer share it).
/// Pure function of the resolution + inventory; never touches hardware.
/// The production consumer is the post-Q-05 installer lane; today this
/// is exercised by tests only.
#[allow(dead_code)]
pub fn speech_asset_candidates<R: Runtime>(
    app: &AppHandle<R>,
) -> (AssetResolution, Vec<(InventoryEntry, std::path::PathBuf)>) {
    let res = resolve_speech_assets(app);
    let inventory: Option<InventoryRecord> = res
        .inventory_text
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok());
    let entries = inventory.map(|inv| inv.entries).unwrap_or_default();
    let rows = entries
        .into_iter()
        .map(|entry| {
            let path = res
                .root_for(&entry)
                .unwrap_or_else(|| res
                    .candidates()
                    .first()
                    .cloned()
                    .unwrap_or_default()
                    .join(entry.relative_path()));
            (entry, path)
        })
        .collect();
    (res, rows)
}

// Only reachable from the receipt writer (installer-lane consumer, see
// [`write_receipt`]); kept dependency-free — no chrono needed for one
// RFC 3339 timestamp.
#[allow(dead_code)]
fn now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d) = civil_from_days((secs / 86_400) as i64);
    let tod = secs % 86_400;
    let (h, m, s) = (tod / 3_600, (tod % 3_600) / 60, tod % 60);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Days-since-epoch -> (year, month, day) proleptic Gregorian
/// (Howard Hinnant's algorithm). Only reachable via [`now_rfc3339`].
#[allow(dead_code)]
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, filename: &str, install_path: Option<&str>) -> InventoryEntry {
        InventoryEntry {
            id: id.into(),
            filename: filename.into(),
            version: "1".into(),
            license: "MIT".into(),
            arch: "universal".into(),
            sha256: Some("abc123".into()),
            sha256_status: None,
            source_url: Some("https://example.invalid/asset".into()),
            role: None,
            bundled: None,
            install_path: install_path.map(str::to_string),
        }
    }

    #[test]
    fn relative_path_prefers_install_path_then_legacy_dir() {
        let with = entry("stt-model", "ggml-tiny.en-q5_1.bin", Some("stt/ggml-tiny.en-q5_1.bin"));
        assert_eq!(with.relative_path(), std::path::PathBuf::from("stt/ggml-tiny.en-q5_1.bin"));
        let legacy = entry("stt-model", "ggml-tiny.en-q5_1.bin", None);
        assert_eq!(legacy.relative_path(), std::path::PathBuf::from("stt/ggml-tiny.en-q5_1.bin"));
        let unknown = entry("custom", "custom.bin", None);
        assert_eq!(unknown.relative_path(), std::path::PathBuf::from("custom.bin"));
    }

    /// The committed manifest is the truth source (design 5.1). If the
    /// generator drifts from this parser (key renames, schema bumps) this
    /// test fails at `cargo test` — pins must never silently unload.
    #[test]
    fn real_manifest_parses_and_pins_load() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("speech-assets")
            .join("SPEECH-INVENTORY.json");
        let text = std::fs::read_to_string(&path).expect("committed manifest present");
        let inv: InventoryRecord = serde_json::from_str(&text).expect("manifest parses");
        assert_eq!(inv.schema, "candice.speech-inventory/v1");
        let stt = inv
            .entries
            .iter()
            .find(|e| e.id == "stt-model")
            .expect("stt-model row");
        assert_eq!(
            stt.sha256.as_deref().unwrap(),
            "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b"
        );
        assert_eq!(
            stt.source_url.as_deref().unwrap(),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin"
        );
        assert_eq!(
            stt.install_path.as_deref().unwrap(),
            "stt/ggml-tiny.en-q5_1.bin"
        );
        // Design 5.4 checksum authority: the verifiable payload rows
        // (models + binaries) must carry pins; the worker script and
        // runtime-pin rows get their hash pins with the post-Q-05
        // installer work (health proves presence for those today).
        const VERIFIED_IDS: &[&str] = &[
            "stt-model",
            "stt-binary-macos",
            "stt-binary-windows-x64",
            "stt-binary-windows-win32",
            "tts-model",
            "tts-voices",
        ];
        for e in &inv.entries {
            assert!(
                e.install_path.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
                "entry {} must carry an installPath",
                e.id
            );
            if VERIFIED_IDS.contains(&e.id.as_str()) {
                assert!(
                    e.sha256.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
                    "entry {} must carry a sha256 pin",
                    e.id
                );
            }
        }
    }

    #[test]
    fn sha256_file_matches_known_vector() {
        let dir = std::env::temp_dir().join(format!("candice-assets-sha-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("vec.bin");
        std::fs::write(&f, b"abc").unwrap();
        // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            sha256_file(&f).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn receipt_write_is_atomic_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("candice-assets-receipt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = vec![ReceiptRow {
            id: "stt-model".into(),
            filename: "ggml-tiny.en-q5_1.bin".into(),
            sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b".into(),
            source_url: "https://huggingface.co/ggerganov/whisper.cpp".into(),
            placed_at: "2026-08-23T00:00:00Z".into(),
        }];
        let path = write_receipt(&dir, &rows, "test").unwrap();
        assert_eq!(path.file_name().unwrap(), RECEIPT_FILENAME);
        let parsed: ReceiptRecord =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed.schema, "candice.speech-asset-receipt/v1");
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].sha256, rows[0].sha256);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn receipt_refuses_missing_root() {
        let dir = std::env::temp_dir().join(format!("candice-assets-missing-{}", std::process::id()));
        let err = write_receipt(&dir, &[], "test").unwrap_err();
        assert!(err.contains("not a directory"), "{err}");
    }

    #[test]
    fn civil_from_days_matches_epoch() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_670), (2026, 8, 5));
    }
}
