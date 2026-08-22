//! WS-17 in-memory ring buffer for captured PCM.
//!
//! Spec 8 preferred path: `microphone -> in-memory/ring buffer -> whisper.cpp
//! -> transcript -> discard audio`. This module is that buffer: it never
//! touches disk and never logs audio.
//!
//! Ring semantics: bounded capacity; once full the oldest chunk is evicted
//! and `append` returns `true` so the controller can enforce the duration
//! limit. `finish` consumes the buffer into a flat recording and empties it
//! (discard-on-release, spec 8/20).

use crate::config::RING_BUFFER_CAPACITY;

/// One PCM chunk captured from the microphone (f32, [-1, 1]).
#[derive(Debug, Clone)]
pub struct CaptureChunk {
    pub sequence: u64,
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved? No — planar per channel. This buffer stores mono f32;
    /// the source downmixes. `samples` holds `channels` planar slices of
    /// equal length.
    pub samples: Vec<f32>,
    pub captured_at_ms: u64,
}

impl CaptureChunk {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1) as usize
    }
}

/// A complete press-hold-release recording, ready for WS-18 transcription.
#[derive(Debug, Clone)]
pub struct Recording {
    pub chunks: Vec<CaptureChunk>,
    pub sample_rate: u32,
    pub channels: u16,
    pub total_samples: usize,
    pub duration_ms: u64,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
}

impl Recording {
    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RingStats {
    pub capacity: usize,
    pub held: usize,
    pub total_appended: u64,
    pub is_full: bool,
}

/// Bounded in-memory PCM buffer.
#[derive(Debug)]
pub struct RingBuffer {
    capacity: usize,
    live: Vec<CaptureChunk>,
    latest: Vec<CaptureChunk>,
    total_appended: u64,
}

impl Default for RingBuffer {
    fn default() -> Self {
        Self::with_capacity(RING_BUFFER_CAPACITY)
    }
}

impl RingBuffer {
    pub fn with_capacity(capacity: usize) -> Self {
        assert!(
            capacity > 0,
            "RingBuffer capacity must be a positive integer"
        );
        Self {
            capacity,
            live: Vec::with_capacity(capacity),
            latest: Vec::with_capacity(capacity),
            total_appended: 0,
        }
    }

    /// Append one chunk. Returns `true` when the buffer became full
    /// (oldest chunk was evicted).
    pub fn append(&mut self, chunk: CaptureChunk) -> bool {
        self.latest.push(chunk.clone());
        if self.latest.len() > self.capacity {
            self.latest.remove(0);
        }
        self.live.push(chunk);
        if self.live.len() > self.capacity {
            self.live.remove(0); // evict oldest
        }
        self.total_appended += 1;
        self.live.len() >= self.capacity
    }

    pub fn len(&self) -> usize {
        self.live.len()
    }

    pub fn is_empty(&self) -> bool {
        self.live.is_empty()
    }

    pub fn is_full(&self) -> bool {
        self.live.len() >= self.capacity
    }

    pub fn stats(&self) -> RingStats {
        RingStats {
            capacity: self.capacity,
            held: self.live.len(),
            total_appended: self.total_appended,
            is_full: self.is_full(),
        }
    }

    /// Most recent chunks (never consumed) for transient retries (WS-20).
    pub fn peek_latest(&self, count: usize) -> Vec<CaptureChunk> {
        let start = self.latest.len().saturating_sub(count);
        self.latest[start..].to_vec()
    }

    /// Consume the buffer into a flat recording, then empty it (discard).
    pub fn finish(&mut self, started_at_ms: u64, ended_at_ms: u64) -> Recording {
        let chunks = std::mem::take(&mut self.live);
        if chunks.is_empty() {
            return Recording {
                chunks,
                sample_rate: 0,
                channels: 0,
                total_samples: 0,
                duration_ms: 0,
                started_at_ms,
                ended_at_ms,
            };
        }
        let sample_rate = chunks[0].sample_rate;
        let channels = chunks[0].channels;
        let total_samples = chunks.iter().map(|c| c.samples.len()).sum();
        let duration_ms = ended_at_ms.saturating_sub(started_at_ms);
        Recording {
            chunks,
            sample_rate,
            channels,
            total_samples,
            duration_ms,
            started_at_ms,
            ended_at_ms,
        }
    }

    /// Drop everything (cancel/dispose/discard-on-release).
    pub fn reset(&mut self) {
        self.live.clear();
        self.latest.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(seq: u64, frames: usize, value: f32) -> CaptureChunk {
        CaptureChunk {
            sequence: seq,
            sample_rate: 16_000,
            channels: 1,
            samples: vec![value; frames],
            captured_at_ms: 0,
        }
    }

    #[test]
    fn accumulates_and_finish_consumes() {
        let mut rb = RingBuffer::default();
        rb.append(chunk(0, 512, 0.5));
        rb.append(chunk(1, 512, 0.5));
        assert_eq!(rb.len(), 2);
        let rec = rb.finish(100, 250);
        assert_eq!(rec.chunks.len(), 2);
        assert_eq!(rec.total_samples, 1024);
        assert_eq!(rec.duration_ms, 150);
        assert_eq!(rec.chunks[1].sequence, 1);
        assert!(rb.is_empty(), "finish must empty the buffer (discard rule)");
    }

    #[test]
    fn evicts_oldest_at_capacity_and_reports_full() {
        let mut rb = RingBuffer::with_capacity(3);
        let mut full = false;
        for i in 0..4 {
            full = rb.append(chunk(i, 512, 0.5));
        }
        assert!(full);
        assert_eq!(rb.len(), 3);
        let s = rb.stats();
        assert_eq!(s.held, 3);
        assert_eq!(s.capacity, 3);
        assert_eq!(s.total_appended, 4);
        let rec = rb.finish(0, 0);
        assert_eq!(rec.chunks[0].sequence, 1, "oldest chunk evicted");
    }

    #[test]
    #[should_panic]
    fn rejects_zero_capacity() {
        let _ = RingBuffer::with_capacity(0);
    }

    #[test]
    fn peek_latest_never_consumes() {
        let mut rb = RingBuffer::with_capacity(2);
        rb.append(chunk(0, 512, 0.5));
        rb.append(chunk(1, 512, 0.5));
        rb.append(chunk(2, 512, 0.5));
        let latest = rb.peek_latest(2);
        assert_eq!(latest.len(), 2);
        assert_eq!(latest[0].sequence, 1);
        assert_eq!(rb.len(), 2, "peek must not consume");
    }
}
