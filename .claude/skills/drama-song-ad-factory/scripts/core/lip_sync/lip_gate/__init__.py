"""lip_gate package: event-based lip-sync gate (review 13) + picture gate. Stdlib only, $0."""
from __future__ import annotations

from .lip_gate import (  # noqa: F401
    IMPROVED_INPUT, KEPT, LIP_SAME_INPUT, LIP_TRY_LIMIT, LIP_UNMEASURED,
    MAX_TRIES, NOT_SYNCED, SYNCED, UNMEASURABLE, WEAK, LipsyncTryLimit,
    envelope, event_sync, events, hard_defect, jobs_for_segment, kling_prompt,
    mouth_series, qc_check, rebase_words, run_gate, scale_events, score,
    segment_key, selftest, voiced_runs,
)
from .image_gate import (  # noqa: F401
    LipsyncImageRefused, check_source_image, closeup_prompt, image_size,
    require_source_image,
)
