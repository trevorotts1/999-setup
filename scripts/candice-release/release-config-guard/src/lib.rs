//! Q-10 release-updater guard crate.
//!
//! Two build paths must never blur (Candice Quality Review Q-10):
//!
//! - SMOKE builds build from the committed `tauri.conf.json` and must not
//!   claim updater-ready artifacts (`createUpdaterArtifacts` disabled).
//! - RELEASE builds build from a release overlay config with the real
//!   updater public key and must be signed with `TAURI_SIGNING_PRIVATE_KEY`.
//!   tauri-bundler hard-fails when that key is absent but only WARNS when
//!   the key does not match the configured public key — so the hard match
//!   check lives here: the same verification the updater plugin performs at
//!   install time (`minisign::verify`, `allow_legacy=true`) must accept a
//!   signature made with the configured key before a release build is
//!   allowed to continue.
//!
//! `bail_on_release_config_mismatch` implements the strongest form of that
//! contract available offline: it validates both config postures statically
//! and, when handed a release config with `createUpdaterArtifacts` enabled,
//! refuses to continue (exit 2) — the CI release path supplies the signing
//! key through the secrets mechanism and proves the match end-to-end at
//! runtime with the signed updater manifest (see
//! `scripts/candice-release/updater-sign.mjs` and its test suite), while a
//! release config with updater artifacts and a placeholder pubkey must
//! never be accepted silently.

use minisign::{PublicKeyBox, SignatureBox};

pub const PUBKEY_PLACEHOLDER: &str = "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Posture {
    Smoke,
    Release,
}

#[derive(Debug, Clone)]
pub struct PostureReport {
    pub posture: Posture,
    pub updater_artifacts_enabled: bool,
    pub placeholder_pubkey: bool,
}

pub fn read_config_posture(config: &serde_json::Value) -> Result<PostureReport, String> {
    let bundle = config.get("bundle").ok_or("bundle section is missing")?;
    let updater = config
        .get("plugins")
        .and_then(|p| p.get("updater"))
        .ok_or("plugins.updater section is missing")?;
    let create = bundle.get("createUpdaterArtifacts");
    let updater_enabled = matches!(create, Some(serde_json::Value::Bool(true)))
        || matches!(create, Some(serde_json::Value::String(s)) if !s.is_empty());
    let pubkey = updater
        .get("pubkey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let placeholder = pubkey == PUBKEY_PLACEHOLDER;
    let posture = if updater_enabled && !placeholder {
        Posture::Release
    } else {
        Posture::Smoke
    };
    Ok(PostureReport {
        posture,
        updater_artifacts_enabled: updater_enabled,
        placeholder_pubkey: placeholder,
    })
}

/// Validate a build posture against the two orthogonal config dimensions:
/// `createUpdaterArtifacts` (enabled/disabled) and the pubkey
/// (placeholder/real). Only two honest states exist:
///
/// - Smoke: updater artifacts disabled + real (non-placeholder) pubkey. The
///   committed config carries a real pubkey whose private key is discarded,
///   so a smoke build embeds a valid updater identity but never claims
///   updater-ready artifacts.
/// - Release: updater artifacts enabled + real pubkey.
///
/// Every other combination is a misconfiguration (the Q-10 defect shapes:
/// updater artifacts enabled while the pubkey is still a placeholder, or a
/// placeholder pubkey re-entering the committed config) and fails closed for
/// both expected postures.
pub fn validate_posture(config: &serde_json::Value, expected: Posture) -> Result<Posture, Vec<String>> {
    let report = read_config_posture(config).map_err(|e| vec![e])?;
    match (&expected, report.updater_artifacts_enabled, report.placeholder_pubkey) {
        (Posture::Smoke, false, false) => Ok(Posture::Smoke),
        (Posture::Smoke, true, _) => Err(vec![
            "smoke build must not enable bundle.createUpdaterArtifacts: a smoke artifact must never claim updater-ready posture".into(),
        ]),
        (Posture::Smoke, false, true) => Err(vec![
            "smoke build must not carry the commit-state placeholder pubkey: plugins.updater.pubkey must be a real key identity (Q-10)".into(),
        ]),
        (Posture::Release, true, false) => Ok(Posture::Release),
        (Posture::Release, false, _) => Err(vec![
            "release build must enable bundle.createUpdaterArtifacts: a release artifact without an updater manifest is not a release artifact".into(),
        ]),
        (Posture::Release, true, true) => Err(vec![
            "release build must carry a real plugins.updater.pubkey, never the commit-state placeholder".into(),
        ]),
    }
}

/// Strongest offline release-config contract: refuses (exit 2) to continue
/// when a release config would produce updater artifacts without a
/// machine-verifiable signing match. The release CI path proves the match
/// end-to-end via the signed updater manifest.
pub fn bail_on_release_config_mismatch(config: &serde_json::Value) -> Result<(), Vec<String>> {
    let report = read_config_posture(config).map_err(|e| vec![e])?;
    if report.placeholder_pubkey {
        // The placeholder must never survive into any config, smoke or
        // release: it is the Q-10 root smell. If it is present, updater
        // artifacts are either enabled (unsigned artifact risk) or disabled
        // with a fake identity embedded in the app — both fail closed.
        return Err(vec![
            "plugins.updater.pubkey is the commit-state placeholder: replace it with the real base64 public key before any build (Q-10)".into(),
        ]);
    }
    if report.posture == Posture::Smoke {
        return Ok(()); // smoke posture is honest by construction
    }
    Err(vec![
        "release config enables createUpdaterArtifacts but this offline guard cannot prove the signing key matches the configured public key: the release path must sign artifacts through scripts/candice-release/updater-sign.mjs with TAURI_SIGNING_PRIVATE_KEY from the CI secrets mechanism and verify the manifest end-to-end".into(),
    ])
}

/// Decode a base64 pubkey box (Tauri `tauri signer generate` output format).
pub fn decode_pubkey(pubkey_b64: &str) -> Result<minisign::PublicKey, String> {
    let raw = base64_decode(pubkey_b64)?;
    let boxed = PublicKeyBox::from_string(&raw)
        .map_err(|e| format!("failed to load updater pubkey: {e}"))?;
    boxed.into_public_key()
        .map_err(|e| format!("failed to decode updater pubkey: {e}"))
}

/// Decode a base64 signature payload (Tauri `.sig` file format).
pub fn decode_signature(signature_b64: &str) -> Result<SignatureBox, String> {
    let raw = base64_decode(signature_b64.trim())?;
    SignatureBox::from_string(&raw).map_err(|e| format!("failed to decode updater signature: {e}"))
}

/// Verify a Tauri-format updater signature exactly the way
/// tauri-plugin-updater does at install time (`minisign::verify`,
/// `allow_legacy=true`, `quiet`).
pub fn verify_updater_signature(
    pubkey: &minisign::PublicKey,
    signature: &SignatureBox,
    data: &[u8],
) -> Result<(), String> {
    minisign::verify(
        pubkey,
        signature,
        std::io::Cursor::new(data),
        true,
        false,
        true,
    )
    .map_err(|e| e.to_string())
}

fn base64_decode(value: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| format!("invalid base64 key material: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("invalid utf-8 in key material: {e}"))
}

pub use minisign::{KeyPair, PublicKey, SecretKey, SecretKeyBox};

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(create: serde_json::Value, pubkey: &str) -> serde_json::Value {
        serde_json::json!({
            "bundle": { "createUpdaterArtifacts": create },
            "plugins": { "updater": { "pubkey": pubkey } }
        })
    }

    #[test]
    fn smoke_posture_is_honest_with_real_pubkey_and_disabled_artifacts() {
        // Honest smoke shape: updater artifacts disabled + real pubkey
        // (private key discarded after the pubkey was committed).
        let config = config_with(serde_json::Value::Bool(false), "RWRp0V3qLp1m8sJkZfQx7yNw==");
        assert_eq!(validate_posture(&config, Posture::Smoke).unwrap(), Posture::Smoke);
        assert!(bail_on_release_config_mismatch(&config).is_ok());
        let report = read_config_posture(&config).unwrap();
        assert_eq!(report.posture, Posture::Smoke);
    }

    #[test]
    fn smoke_posture_rejects_updater_artifacts() {
        let config = config_with(serde_json::Value::Bool(true), PUBKEY_PLACEHOLDER);
        let err = validate_posture(&config, Posture::Smoke).unwrap_err();
        assert!(err.iter().any(|e| e.contains("smoke")));
    }

    #[test]
    fn smoke_posture_rejects_placeholder_pubkey() {
        // A placeholder pubkey in the committed config is the Q-10 smell:
        // even with updater artifacts disabled, the committed identity must
        // be a real key.
        let config = config_with(serde_json::Value::Bool(false), PUBKEY_PLACEHOLDER);
        let err = validate_posture(&config, Posture::Smoke).unwrap_err();
        assert!(err.iter().any(|e| e.contains("placeholder")), "{err:?}");
        assert!(bail_on_release_config_mismatch(&config).is_err());
    }

    #[test]
    fn release_posture_requires_real_pubkey_and_updater_artifacts() {
        let config = config_with(
            serde_json::Value::String("v1Compatible".into()),
            "RWRp0V3qLp1m8sJkZfQx7yNw==",
        );
        assert_eq!(validate_posture(&config, Posture::Release).unwrap(), Posture::Release);
    }

    #[test]
    fn release_posture_rejects_placeholder() {
        let config = config_with(
            serde_json::Value::String("v1Compatible".into()),
            PUBKEY_PLACEHOLDER,
        );
        let err = validate_posture(&config, Posture::Release).unwrap_err();
        assert!(err.iter().any(|e| e.contains("placeholder") || e.contains("pubkey")));
    }

    #[test]
    fn release_posture_rejects_disabled_updater_artifacts() {
        let config = config_with(serde_json::Value::Bool(false), "RWRp0V3qLp1m8sJkZfQx7yNw==");
        assert!(validate_posture(&config, Posture::Release).is_err());
    }

    #[test]
    fn updater_artifacts_with_placeholder_pubkey_bails_even_for_smoke_classification() {
        // The Q-10 defect shape: createUpdaterArtifacts enabled while the
        // pubkey is still the placeholder. This classifies as Smoke posture
        // but must still bail hard — it is a misconfigured release, not a
        // smoke build.
        let config = config_with(serde_json::Value::Bool(true), PUBKEY_PLACEHOLDER);
        let err = bail_on_release_config_mismatch(&config).unwrap_err();
        assert!(err.iter().any(|e| e.contains("placeholder")), "{err:?}");
    }

    #[test]
    fn placeholder_pubkey_bails_hard_in_both_postures() {
        // Placeholder must never be acceptable: not in a smoke config, not
        // in a release config.
        for create in [false, true] {
            let config = config_with(serde_json::Value::Bool(create), PUBKEY_PLACEHOLDER);
            assert!(
                bail_on_release_config_mismatch(&config).is_err(),
                "create={create} must bail"
            );
        }
    }

    #[test]
    fn release_config_without_verified_key_bails() {
        let config = config_with(
            serde_json::Value::String("v1Compatible".into()),
            "RWRp0V3qLp1m8sJkZfQx7yNw==",
        );
        let err = bail_on_release_config_mismatch(&config).unwrap_err();
        assert!(err.iter().any(|e| e.contains("signing key")), "{err:?}");
    }

    #[test]
    fn signed_artifact_verifies_end_to_end_against_pubkey() {
        let KeyPair { pk, sk } =
            KeyPair::generate_encrypted_keypair(Some("guard-test".to_string())).unwrap();
        let secret_key = sk
            .to_box(None)
            .unwrap()
            .into_secret_key(Some("guard-test".to_string()))
            .unwrap();

        let artifact = b"candice updater artifact bytes".to_vec();
        let signature_box = minisign::sign(
            None,
            &secret_key,
            std::io::Cursor::new(&artifact[..]),
            Some("timestamp:1\tfile:test.tar.gz"),
            Some("guard test"),
        )
        .unwrap();
        let encoded_sig = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(signature_box.to_string())
        };
        let pubkey_b64 = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(pk.to_box().unwrap().to_string())
        };

        let public_key = decode_pubkey(&pubkey_b64).unwrap();
        let signature = decode_signature(&encoded_sig).unwrap();
        verify_updater_signature(&public_key, &signature, &artifact).unwrap();
    }

    #[test]
    fn wrong_key_signature_is_rejected() {
        let KeyPair { sk: sk_a, .. } =
            KeyPair::generate_encrypted_keypair(Some("a".to_string())).unwrap();
        let KeyPair { pk: pk_b, .. } =
            KeyPair::generate_encrypted_keypair(Some("b".to_string())).unwrap();
        let secret_key = sk_a
            .to_box(None)
            .unwrap()
            .into_secret_key(Some("a".to_string()))
            .unwrap();
        let artifact = b"payload".to_vec();
        let signature_box = minisign::sign(
            None,
            &secret_key,
            std::io::Cursor::new(&artifact[..]),
            None,
            None,
        )
        .unwrap();
        let encoded_sig = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(signature_box.to_string())
        };
        let pubkey_b64 = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(pk_b.to_box().unwrap().to_string())
        };
        let public_key = decode_pubkey(&pubkey_b64).unwrap();
        let signature = decode_signature(&encoded_sig).unwrap();
        assert!(verify_updater_signature(&public_key, &signature, &artifact).is_err());
    }

    #[test]
    fn tampered_artifact_is_rejected() {
        let KeyPair { pk, sk } =
            KeyPair::generate_encrypted_keypair(Some("t".to_string())).unwrap();
        let secret_key = sk
            .to_box(None)
            .unwrap()
            .into_secret_key(Some("t".to_string()))
            .unwrap();
        let artifact = b"original".to_vec();
        let signature_box = minisign::sign(
            None,
            &secret_key,
            std::io::Cursor::new(&artifact[..]),
            None,
            None,
        )
        .unwrap();
        let encoded_sig = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(signature_box.to_string())
        };
        let pubkey_b64 = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(pk.to_box().unwrap().to_string())
        };
        let public_key = decode_pubkey(&pubkey_b64).unwrap();
        let signature = decode_signature(&encoded_sig).unwrap();
        assert!(verify_updater_signature(&public_key, &signature, b"tampered").is_err());
    }
}
