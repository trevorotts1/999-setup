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

    tauri_build::build();
}
