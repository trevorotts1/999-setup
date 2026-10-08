# Stage runbook

`factory.py next --run-dir <dir>` reads this table: the first cell is the stage id (same order as
`batch_mode/batch.py` STAGES), the second is the command (in backticks, run from the skill root),
the third is what the stage produces. `$RUN` is the run folder, `$RUN_ID` the run id.
After the command passes its QC gate, run `next` again.

| stage id | command | produces |
|---|---|---|
| research | `python3 scripts/core/research_engine/research.py --brief "$RUN/brief.json" --outdir "$RUN" --run-id "$RUN_ID"` | research/ and brief/ folders |
| creative-strategy | `python3 scripts/core/story_arc/story_arc.py --story "$RUN/creative/story.json"` | validated twelve-beat story arc |
| script-lyrics | `python3 scripts/core/lyric_writer/lyric_writer.py --lyrics "$RUN/lyrics/lyrics.json" --brief "$RUN/brief.json"` | checked sung lyrics |
| music | `python3 scripts/core/audio_c3/lyric_timing.py` | word timings for the approved track |
| continuity-bible | `python3 scripts/core/character_library/character_library.py --client-dir "$RUN/client" list` | approved characters and style bible |
| storyboard | `python3 scripts/core/shot_planner/speaker_check/speaker_check.py` | shot plan with on-screen speaker check |
| image-keyframes | `python3 scripts/core/kie_dispatch/kie_dispatch.py dispatch --run-id "$RUN_ID"` | keyframe images through Skill 74 |
| video-generation | `python3 scripts/core/video_router/video_router.py --request "$RUN/video/request.json"` | routed video clip requests |
| qc-retakes | `python3 scripts/core/retake_manager/retake_manager.py --request "$RUN/qc/retake-request.json"` | targeted retake plan |
| assembly | `python3 scripts/core/final_assembler/assembler.py "$RUN/assembly/timeline.json" "$RUN/assembly/master.mp4"` | assembled master |
| final-qc | `python3 scripts/core/qc_gate.py evaluate --run "$RUN_ID" --stage final-qc` | independent QC gate record |
| delivery | `python3 scripts/core/delivery_checklist/delivery_checklist.py check --receipt "$RUN/delivery/receipt.json"` | delivery checklist verdict |
