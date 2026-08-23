//! Q-10 updater signing helper binary (candice-release-config-guard).
//!
//! Two subcommands, no secret on argv, no secret printed:
//!
//!   sign   — read a minisign secret key box from `--key-file` (optionally
//!            password-encrypted via `--password`), sign `--artifact`, write
//!            the Tauri-format signature (base64 of the minisign signature
//!            text) to `--out`.
//!   verify — decode `--pubkey-b64` (Tauri config pubkey, base64 of the
//!            minisign public key text), read `--signature-file`, verify
//!            `--artifact` exactly the way tauri-plugin-updater does at
//!            install time (minisign::verify, allow_legacy=true).
//!
//! Exit codes: 0 success, 1 verification/signing failure, 2 usage error.
//! This binary is the CI hard-match gate: the release path must prove the
//! configured pubkey accepts a signature made with the injected secret key.

use std::fs;

use candice_release_config_guard::{
    decode_pubkey, decode_signature, verify_updater_signature,
};
use minisign::{sign, SecretKey, SecretKeyBox};

fn usage() -> ! {
    eprintln!(
        "usage:\n  updater-sign-helper sign --key-file <f> [--password <pw>] --artifact <f> --out <f>\n  updater-sign-helper verify --pubkey-b64 <s> --signature-file <f> --artifact <f>"
    );
    std::process::exit(2);
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    let idx = args.iter().position(|a| a == name)?;
    args.get(idx + 1).cloned()
}

fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(subcommand) = args.first() else {
        usage();
    };
    match subcommand.as_str() {
        "sign" => {
            let key_file = arg_value(&args, "--key-file").unwrap_or_else(|| usage());
            let password = arg_value(&args, "--password").unwrap_or_default();
            let artifact = arg_value(&args, "--artifact").unwrap_or_else(|| usage());
            let out = arg_value(&args, "--out").unwrap_or_else(|| usage());

            let box_text = match read_file(&key_file) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("updater-sign-helper: {e}");
                    std::process::exit(1);
                }
            };
            let secret_key: SecretKey = match SecretKeyBox::from_string(box_text.trim_end()) {
                Ok(boxed) => {
                    let password = if password.is_empty() { None } else { Some(password) };
                    match boxed.into_secret_key(password) {
                        Ok(sk) => sk,
                        Err(e) => {
                            eprintln!("updater-sign-helper: cannot unlock secret key: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("updater-sign-helper: invalid secret key box: {e}");
                    std::process::exit(1);
                }
            };
            let data = match fs::read(&artifact) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("updater-sign-helper: cannot read artifact {artifact}: {e}");
                    std::process::exit(1);
                }
            };
            let signature_box = match sign(
                None,
                &secret_key,
                std::io::Cursor::new(&data),
                None,
                None,
            ) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("updater-sign-helper: signing failed: {e}");
                    std::process::exit(1);
                }
            };
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(signature_box.to_string().trim_end().as_bytes());
            if let Err(e) = fs::write(&out, format!("{encoded}\n")) {
                eprintln!("updater-sign-helper: cannot write signature {out}: {e}");
                std::process::exit(1);
            }
        }
        "verify" => {
            let pubkey_b64 = arg_value(&args, "--pubkey-b64").unwrap_or_else(|| usage());
            let signature_file = arg_value(&args, "--signature-file").unwrap_or_else(|| usage());
            let artifact = arg_value(&args, "--artifact").unwrap_or_else(|| usage());

            let pubkey = match decode_pubkey(&pubkey_b64) {
                Ok(pk) => pk,
                Err(e) => {
                    eprintln!("updater-sign-helper: {e}");
                    std::process::exit(1);
                }
            };
            let signature_text = match read_file(&signature_file) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("updater-sign-helper: {e}");
                    std::process::exit(1);
                }
            };
            let signature_box = match decode_signature(&signature_text) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("updater-sign-helper: {e}");
                    std::process::exit(1);
                }
            };
            let data = match fs::read(&artifact) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("updater-sign-helper: cannot read artifact {artifact}: {e}");
                    std::process::exit(1);
                }
            };
            if let Err(e) = verify_updater_signature(&pubkey, &signature_box, &data) {
                eprintln!("updater-sign-helper: signature verification failed: {e}");
                std::process::exit(1);
            }
        }
        _ => usage(),
    }
}
