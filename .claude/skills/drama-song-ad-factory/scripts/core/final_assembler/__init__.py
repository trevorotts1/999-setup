"""final_assembler package: timeline.json -> frame-exact ffmpeg render."""
from .assembler import (
    EXIT,
    SCHEMA_VERSION,
    TIMELINE_SCHEMA,
    TOOL_NAME,
    TOOL_VERSION,
    assemble,
    build_argv,
    load_timeline,
    plan_timeline,
)
from .master_provenance import (
    check_master_provenance,
    to_qc_record as master_provenance_qc_record,
)

__all__ = [
    "check_master_provenance",
    "master_provenance_qc_record",
    "EXIT",
    "SCHEMA_VERSION",
    "TIMELINE_SCHEMA",
    "TOOL_NAME",
    "TOOL_VERSION",
    "assemble",
    "build_argv",
    "load_timeline",
    "plan_timeline",
]
