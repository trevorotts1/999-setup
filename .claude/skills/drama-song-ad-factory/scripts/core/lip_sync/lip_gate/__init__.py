"""lip_gate package: measured lip-sync gate, validated sync check + looser verdicts (LSL002). Stdlib only, $0."""
from __future__ import annotations

from .lip_gate import (  # noqa: F401
    FAIL, FLAG, IMPROVED_INPUT, LIP_UNMEASURED, MAX_PAID_ATTEMPTS, PASS,
    UNDETERMINED, UNMEASURABLE, UNMEASURED, envelope, judge, measure, mouth_series,
    qc_check, run_gate, score,
)
from .sync_check import judge_sync, measure_clip_landmarks, measure_sync  # noqa: F401
from .image_gate import (  # noqa: F401
    LipsyncImageRefused, check_source_image, closeup_prompt, image_size,
    require_source_image,
)
