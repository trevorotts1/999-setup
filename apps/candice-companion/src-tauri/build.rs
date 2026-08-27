fn main() {
    // tauri.conf.json lives at the app root (apps/candice-companion/tauri.conf.json)
    // per Master Spec section 12 layout, snapshot owned_paths, and ownership map
    // 9.3 (within-run shared set). tauri-build's config resolver reads the file
    // from the build script's working directory (the crate manifest dir) and
    // errors if absent — it cannot be redirected via env before that step.
    // Solution: mirror the app-root config into this manifest dir as a generated
    // file (gitignored) each build. The app-root file remains the single source
    // of truth; generate_context!() in lib.rs reads it directly.
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let app_root_config = manifest_dir.join("..").join("tauri.conf.json");
    let generated_config = manifest_dir.join("tauri.conf.json");

    println!("cargo:rerun-if-changed={}", app_root_config.display());
    if let Ok(config) = std::fs::read(&app_root_config) {
        std::fs::write(&generated_config, config).expect("failed to mirror tauri.conf.json");
    } else {
        panic!(
            "missing app-root tauri.conf.json at {}",
            app_root_config.display()
        );
    }

    // Mirror the PLATFORM OVERLAYS too, or they are silently not applied.
    //
    // Tauri merges `tauri.<platform>.conf.json` from the same directory as
    // the base config (RFC 7396). Only `npm run tauri:build` staged them,
    // via scripts/stage-tauri-config.mjs -- so a build invoked directly as
    // `cargo tauri build` or `tauri build`, which is what a CI job or a
    // fresh clone naturally does, succeeded with NO override at all. That
    // is exactly how the Windows installer would go back to carrying 378 MB
    // of macOS-arm64 Python: green build, right filename present in the
    // repo, override never read. Failing in the SUCCESS direction is the
    // worst shape a packaging bug can have.
    for platform in ["windows", "macos", "linux"] {
        let name = format!("tauri.{platform}.conf.json");
        let source = manifest_dir.join("..").join(&name);
        let mirrored = manifest_dir.join(&name);
        println!("cargo:rerun-if-changed={}", source.display());
        match std::fs::read(&source) {
            Ok(bytes) => std::fs::write(&mirrored, bytes)
                .unwrap_or_else(|e| panic!("failed to mirror {name}: {e}")),
            // Absent is legitimate -- only a platform that needs an override
            // has one. A STALE mirror is not: it would keep applying an
            // override the source no longer carries, which is the same
            // silent-wrong-config failure in the other direction.
            Err(_) => {
                let _ = std::fs::remove_file(&mirrored);
            }
        }
    }

    tauri_build::build();
}
