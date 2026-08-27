//! TTS speech-timing event surface (FIX-016).
//!
//! Minimal native emit in the audio duplex path: the TTS/duplex lanes
//! report the three timing facts this channel carries — speech start
//! (with phoneme timings), utterance boundary, and playback drain — and
//! the shell re-emits them as validated events on the existing bridge
//! event surface. The webview-side viseme scheduler (WS-12) consumes
//! those events; this module only validates payload shape before emit.
//!
//! No new auth surface: the events travel over the same `app.emit`
//! surface as `candice:bridge-question` / `candice:bridge-cancel`, the
//! commands live in the same `invoke_handler` list as the existing shell
//! commands, and no capability permission is added (`core:default`
//! already covers event emit/listen). Validation here is format
//! sanitation (finite spans, bounded count, opaque id), not
//! authorization — a webview caller is already inside the shell.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

pub const SPEECH_TIMING_SCHEMA_VERSION: &str = "1.0";
pub const SPEECH_START_EVENT: &str = "candice:speech-start";
pub const SPEECH_BOUNDARY_EVENT: &str = "candice:speech-boundary";
pub const SPEECH_DRAIN_EVENT: &str = "candice:speech-drain";

/// Hard ceiling on phoneme timings per utterance. Real Kokoro utterances
/// carry hundreds of spans; anything beyond this is rejected as malformed.
const MAX_TIMINGS: usize = 4096;

/// One phoneme span inside synthesized audio (mirror of the WS-19
/// `PhonemeTiming` contract in `src-tauri/tts/types.ts`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTiming {
    pub phoneme: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStartPayload {
    pub schema_version: String,
    pub utterance_id: String,
    pub timings: Vec<SpeechTiming>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechMarkerPayload {
    pub schema_version: String,
    pub utterance_id: String,
}

fn valid_utterance_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| matches!(byte, b'!'..=b'~'))
}

/// Is this string a plausible phoneme label?
///
/// THE authority for that question -- `engines.rs` calls this rather than
/// keeping its own copy. It used to keep one, and both copies independently
/// required `is_ascii_graphic()`. Kokoro drives espeak-ng, which emits IPA:
/// on a measured 48-span utterance that rule silently discarded 28 spans in
/// `filter_map`, and the 20 survivors were almost all consonants, so the
/// mouth stayed shut for 85% of the audio. Two agreeing copies of a wrong
/// rule look like corroboration; that is why there is now only one.
///
/// The rule is a DENY-list, not an allow-list, because the phoneme alphabet
/// belongs to the voice engine and will change again: reject control and
/// format characters (terminal escapes, bidi overrides, zero-width joiners)
/// and admit everything else. These strings are only ever used as viseme
/// lookup keys -- never rendered, never executed.
pub(crate) fn valid_phoneme(phoneme: &str) -> bool {
    !phoneme.is_empty()
        && phoneme.chars().count() <= 16
        && !phoneme.chars().any(|c| {
            c.is_control()
                || matches!(c,
                    '\u{200b}'..='\u{200f}'
                    | '\u{2028}'..='\u{202e}'
                    | '\u{2060}'..='\u{2064}'
                    | '\u{feff}')
        })
}

/// Validate one phoneme timing span. Mirrors the WS-12 ingestion rule:
/// non-finite or non-positive spans are garbage and must never reach the
/// scheduler.
fn valid_timing(timing: &SpeechTiming) -> bool {
    valid_phoneme(&timing.phoneme)
        && timing.start_sec.is_finite()
        && timing.end_sec.is_finite()
        && timing.end_sec > timing.start_sec
        && timing.start_sec >= 0.0
}

fn validate_utterance_id(value: &str) -> Result<(), String> {
    if valid_utterance_id(value) {
        Ok(())
    } else {
        Err("invalid utterance id".into())
    }
}

/// An utterance with zero timings is legal (the scheduler maps it to
/// idle); a burst beyond the cap is malformed input.
fn validate_timings(timings: &[SpeechTiming]) -> Result<(), String> {
    if timings.len() > MAX_TIMINGS {
        return Err("invalid timing count".into());
    }
    for timing in timings {
        if !valid_timing(timing) {
            return Err("invalid phoneme timing span".into());
        }
    }
    Ok(())
}

/// Emit speech start with phoneme timings. Also the seam a future native
/// duplex path calls directly (no webview round-trip).
pub fn emit_speech_start<R: Runtime>(
    app: &AppHandle<R>,
    utterance_id: &str,
    timings: &[SpeechTiming],
) -> tauri::Result<()> {
    app.emit(
        SPEECH_START_EVENT,
        SpeechStartPayload {
            schema_version: SPEECH_TIMING_SCHEMA_VERSION.into(),
            utterance_id: utterance_id.into(),
            timings: timings.to_vec(),
        },
    )
}

/// Emit an utterance boundary (the current utterance was replaced or
/// interrupted; a new start event follows if speech continues).
pub fn emit_speech_boundary<R: Runtime>(
    app: &AppHandle<R>,
    utterance_id: &str,
) -> tauri::Result<()> {
    app.emit(
        SPEECH_BOUNDARY_EVENT,
        SpeechMarkerPayload {
            schema_version: SPEECH_TIMING_SCHEMA_VERSION.into(),
            utterance_id: utterance_id.into(),
        },
    )
}

/// Emit playback drain (output provably silent; the mouth returns to
/// closed). The duplex controller's finish/tail path is the caller.
pub fn emit_speech_drain<R: Runtime>(
    app: &AppHandle<R>,
    utterance_id: &str,
) -> tauri::Result<()> {
    app.emit(
        SPEECH_DRAIN_EVENT,
        SpeechMarkerPayload {
            schema_version: SPEECH_TIMING_SCHEMA_VERSION.into(),
            utterance_id: utterance_id.into(),
        },
    )
}

#[tauri::command]
pub fn cmd_speech_timing_start<R: Runtime>(
    app: AppHandle<R>,
    utterance_id: String,
    timings: Vec<SpeechTiming>,
) -> Result<(), String> {
    validate_utterance_id(&utterance_id)?;
    validate_timings(&timings)?;
    emit_speech_start(&app, &utterance_id, &timings)
        .map_err(|error| format!("speech timing emit failed: {error}"))
}

#[tauri::command]
pub fn cmd_speech_timing_boundary<R: Runtime>(
    app: AppHandle<R>,
    utterance_id: String,
) -> Result<(), String> {
    validate_utterance_id(&utterance_id)?;
    emit_speech_boundary(&app, &utterance_id)
        .map_err(|error| format!("speech timing emit failed: {error}"))
}

#[tauri::command]
pub fn cmd_speech_timing_drain<R: Runtime>(
    app: AppHandle<R>,
    utterance_id: String,
) -> Result<(), String> {
    validate_utterance_id(&utterance_id)?;
    emit_speech_drain(&app, &utterance_id)
        .map_err(|error| format!("speech timing emit failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timing(phoneme: &str, start_sec: f64, end_sec: f64) -> SpeechTiming {
        SpeechTiming { phoneme: phoneme.into(), start_sec, end_sec }
    }

    #[test]
    fn accepts_valid_utterance_ids_and_rejects_control_or_oversized() {
        assert!(valid_utterance_id("engine-42"));
        assert!(valid_utterance_id("a"));
        assert!(!valid_utterance_id(""));
        assert!(!valid_utterance_id("bad\nid"));
        assert!(!valid_utterance_id(" "));
        assert!(!valid_utterance_id(&"x".repeat(129)));
    }

    #[test]
    fn timing_validation_mirrors_scheduler_ingestion_rules() {
        assert!(valid_timing(&timing("a", 0.1, 0.2)));
        assert!(valid_timing(&timing("aa", 0.0, 0.01)));
        assert!(!valid_timing(&timing("", 0.1, 0.2)));
        assert!(!valid_timing(&timing("a", 0.2, 0.1))); // non-positive span
        assert!(!valid_timing(&timing("a", f64::NAN, 0.1)));
        assert!(!valid_timing(&timing("a", 0.1, f64::INFINITY)));
        assert!(!valid_timing(&timing("a", -1.0, 0.1)));
        assert!(!valid_timing(&timing("a\tb", 0.1, 0.2)));
        // IPA is what the pinned voice actually emits. An ASCII-only rule
        // here silently thinned real utterances until the mouth stopped
        // moving; these are captured espeak-ng outputs, not invented.
        assert!(valid_timing(&timing("\u{259}", 0.1, 0.2)), "schwa");
        assert!(valid_timing(&timing("\u{e6}", 0.1, 0.2)), "ae");
        assert!(valid_timing(&timing("\u{14b}", 0.1, 0.2)), "eng");
        assert!(valid_timing(&timing("\u{2c8}", 0.1, 0.2)), "primary stress");
        assert!(valid_timing(&timing("\u{2d0}", 0.1, 0.2)), "length mark");
        assert!(valid_timing(&timing("\u{283}", 0.1, 0.2)), "esh");
        assert!(valid_timing(&timing(" ", 0.1, 0.2)), "word gap");
        // Control and format characters still do not get through.
        assert!(!valid_phoneme("a\u{1b}[31m"), "terminal escape");
        assert!(!valid_phoneme("a\u{202e}b"), "bidi override");
        assert!(!valid_phoneme("a\u{200b}b"), "zero width space");
        assert!(!valid_phoneme("a\u{feff}"), "byte order mark");
        assert!(!valid_phoneme(""), "empty");
        assert!(!valid_phoneme(&"\u{259}".repeat(17)), "over the 16-char cap");
        assert!(valid_phoneme(&"\u{259}".repeat(16)), "at the 16-char cap");
        assert!(!valid_timing(&timing("a", 0.1, 0.1)));
    }

    #[test]
    fn timing_lists_allow_empty_but_reject_oversized_bursts() {
        assert_eq!(validate_timings(&[]), Ok(()));
        assert!(validate_timings(&[timing("a", 0.1, 0.2)]).is_ok());
        let burst: Vec<SpeechTiming> = (0..=MAX_TIMINGS).map(|i| timing("a", i as f64, i as f64 + 0.5)).collect();
        assert!(validate_timings(&burst).is_err());
    }

    #[test]
    fn start_payload_serializes_camel_case_for_the_webview() {
        let payload = SpeechStartPayload {
            schema_version: SPEECH_TIMING_SCHEMA_VERSION.into(),
            utterance_id: "engine-42".into(),
            timings: vec![timing("a", 0.1, 0.2)],
        };
        let value = serde_json::to_value(&payload).expect("serializable");
        assert_eq!(value["schemaVersion"], "1.0");
        assert_eq!(value["utteranceId"], "engine-42");
        assert_eq!(value["timings"][0]["phoneme"], "a");
        assert_eq!(value["timings"][0]["startSec"], 0.1);
        assert!(value.get("schema_version").is_none());
    }

    #[test]
    fn marker_payload_serializes_camel_case() {
        let value = serde_json::to_value(SpeechMarkerPayload {
            schema_version: SPEECH_TIMING_SCHEMA_VERSION.into(),
            utterance_id: "engine-42".into(),
        }).expect("serializable");
        assert_eq!(value["schemaVersion"], "1.0");
        assert_eq!(value["utteranceId"], "engine-42");
    }
}
