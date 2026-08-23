/**
 * FIX-015 FAIL-4 test fixture: a deterministic fake of the Kokoro Python
 * worker. Spawned by the engine with any interpreter (node in tests), so
 * engine tests exercise the real escalation ladder against a real process.
 *
 * Behavior chosen by WORKER_BEHAVIOR env:
 *  - "eof-exit":      exit(0) when stdin ends (graceful-drain worker)
 *  - "ignore-eof":    keep running on stdin end; exit(0) on SIGTERM
 *  - "ignore-all":    keep running on stdin end AND ignore SIGTERM
 *                     (only SIGKILL, which cannot be trapped, stops it)
 *  - "respond":       reply to each synthesize command with one result
 *                     line, then keep running until EOF
 *  - "never-respond": read stdin forever, write nothing (timeout target)
 *
 * The JSON-lines contract matches src-tauri/tts/index.ts EngineCommand /
 * EngineResult exactly — nothing else.
 */

const behavior = process.env.WORKER_BEHAVIOR ?? "eof-exit";

// float32 [0.1, -0.1, 0.2] little-endian
const PCM_B64 = Buffer.from(new Float32Array([0.1, -0.1, 0.2]).buffer).toString("base64");

process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    if (behavior === "never-respond") continue;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch {
      continue;
    }
    if (cmd.kind !== "synthesize") continue;
    if (behavior === "respond") {
      process.stdout.write(
        `${JSON.stringify({ ok: true, pcmB64: PCM_B64, sampleRate: 24000 })}\n`,
      );
    }
  }
});

process.stdin.on("end", () => {
  switch (behavior) {
    case "eof-exit":
      process.exit(0);
      break;
    case "ignore-eof":
    case "ignore-all":
    case "respond":
    case "never-respond":
      // Keep the process alive so the engine must escalate.
      setInterval(() => {}, 1000);
      break;
  }
});

process.on("SIGTERM", () => {
  if (behavior === "ignore-all") {
    // Ignore SIGTERM entirely; SIGKILL is the only way out.
    return;
  }
  process.exit(0);
});
