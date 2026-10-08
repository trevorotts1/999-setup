# QC CHECKLIST BEFORE DELIVERY — skill 75 drama-song ads (Trevor order 2026-10-08)

Simple on purpose. One independent checker (never the builder) answers these 11 questions on the FINISHED file, each with a MEASURED number or a frame, written into the receipt. A "no" sends back ONLY the failing part to be redone; it never cancels the ad.

1. SUNG? If the client chose a sung style, does the singing detector (measured on the vocal stem, never section labels) find real singing? Measured spoken % of runtime (target 22.5, band 20-25) and sung % of voice time, sung / (sung + spoken) (target 77.5, band 75-80), shown; a music-only intro, gaps and the end card never count against singing. The only hard reject is no sung stretch of 6 s.
2. ON TARGET? Is every share (sung, spoken) and the length within Trevor's band of its target (see question 11): within 5 points accept, over 5 up to 10 accept WITH A FLAG, over 10 adjust and regenerate (bounded) and redo.
3. WORDS? Is every script word present, in order, with nothing invented (diff shown)?
4. FACES? For each shot, one sampled frame: does the face's emotion match its line (no smiling under a pain line)? Frame + line listed.
5. VOICE + MUSIC? Is the music unbroken under the whole ad, no echo/reverb tail, and are spoken lines speech while sung lines are sung?
6. MODELS? Only the locked models were used (MiniMax H3 768P video, gpt-image sunburst images, Suno V6, Kling avatar lip-sync).
7. HONEST RECEIPT? Every number in the receipt comes from a measurement and names its source. Anything unmeasured is written as UNMEASURED, never as a pass.

8. LIP-SYNC MEASURED? For every lip-sync clip, `lip_gate.event_sync` against the lead-vocal span: mouth opening at onsets, closing at offsets and on p, b, m words, within 0.2 s; SYNCED = hit 0.70 or more and margin 0.20 or more over the shifted and other-line controls. WEAK is kept with a flag; UNMEASURABLE (fewer than 4 events, or a face in under 90% of frames) goes to the human mouth strip; NOT_SYNCED (hard defects only) passes only as a flagged KEPT_BEST_OF_2 row after the 2 tries. Verdict, hit, margin, lag, event count, jobs used (at most 2) and the mouth-strip path shown per clip. A sung WEAK or UNMEASURABLE is UNDETERMINED, not bad.
9. FIRST SUNG? Where does the first real singing (measured on the vocal stem) start, as a % of runtime? Goal 15%, judged by the band in question 11. The measured % and the detector are shown.
10. PICTURES MATCH THE WORDS? Every shot lists its time (from the real Suno timestamps), the line it shows, and whether the picture matches that line; no slow-motion above 1.15x. Matched count shown as a number.
11. EVERY NUMBER JUDGED BY TREVOR'S BAND? Every numeric goal (sung %, spoken %, length, first-sung %, lip-sync coverage, any other) is measured against its target: within 5 points = accept; over 5 up to 10 = accept WITH A FLAG written in the receipt; over 10 = REDO (never keep the closest). Measured, target and flag shown for each. CARVE-OUT: lip-sync clips follow Trevor's 2-try keep-best rule (2026-10-08): after 2 paid tries the best-measured take is kept and flagged, so "never keep the closest" does not apply to them.

Report to Trevor only after all 11 are answered. A "yes" without a measurement counts as "no".
