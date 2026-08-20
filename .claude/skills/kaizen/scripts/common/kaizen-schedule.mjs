#!/usr/bin/env node
// Kaizen schedule decision engine.
// Deterministic, no network, no secrets.
//
// usage:
//   node kaizen-schedule.mjs '<interval-input>' [--json-context '<json>']
//
// Prints structured JSON on stdout. Exit 0 on a parseable input;
// exit 2 with an error JSON object on an unparseable input or bad context.

function parseArgs() {
  const a = process.argv.slice(2);
  if (a.length < 1) return { error: "missing interval input" };
  const input = a[0];
  let context = {};
  let contextError = null;
  for (let i = 1; i < a.length; i += 1) {
    if (a[i] === "--json-context" && i + 1 < a.length) {
      try {
        context = JSON.parse(a[i + 1]);
      } catch (err) {
        contextError = String(err);
      }
      i += 1;
    }
  }
  return { input, context, contextError };
}

const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// Returns null when the input does not parse.
// Recognized (case-insensitive): "5m", "20m", "1h", "3d", "every week",
// "weekly", "every 30 days", "monthly", "every 90 days", "quarterly",
// "first day of every month", "every Monday at 9 AM", plus generic
// "<n><unit>" and "every <n> <unit>" forms.
function parseInterval(raw) {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  let m;

  m = s.match(/^(\d+)\s*(m|min|minute|minutes)$/);
  if (m) return { kind: "elapsed", value: Number(m[1]), unit: "m", total_seconds: Number(m[1]) * 60 };
  m = s.match(/^(\d+)\s*(h|hr|hour|hours)$/);
  if (m) return { kind: "elapsed", value: Number(m[1]), unit: "h", total_seconds: Number(m[1]) * 3600 };
  m = s.match(/^(\d+)\s*(d|day|days)$/);
  if (m) return { kind: "elapsed", value: Number(m[1]), unit: "d", total_seconds: Number(m[1]) * 86400 };
  m = s.match(/^(\d+)\s*(w|week|weeks)$/);
  if (m) return { kind: "elapsed", value: Number(m[1]), unit: "week", total_seconds: Number(m[1]) * 604800 };
  m = s.match(/^(\d+)\s*(s|sec|secs|second|seconds)$/);
  if (m) return { kind: "elapsed", value: Number(m[1]), unit: "s", total_seconds: Number(m[1]) };
  m = s.match(/^every\s+(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|s|sec|secs|second|seconds)$/);
  if (m) return parseInterval(`${m[1]}${m[2]}`);

  if (s === "every week" || s === "weekly" || s === "week") {
    return { kind: "calendar", calendar: "weekly", value: 1, unit: "week", weekday: 1, hour: 9, minute: 0 };
  }
  if (s === "monthly" || s === "every month") {
    return { kind: "calendar", calendar: "monthly", value: 1, unit: "month", day: 1, hour: 9, minute: 0, ambiguous: "month" };
  }
  if (s === "quarterly" || s === "every quarter" || s === "every 3 months") {
    return { kind: "calendar", calendar: "quarterly", value: 1, unit: "quarter", months: [1, 4, 7, 10], day: 1, hour: 9, minute: 0, ambiguous: "quarter" };
  }
  if (s === "first day of every month" || s === "the first day of every month" || s === "1st of every month") {
    return { kind: "calendar", calendar: "monthly", value: 1, unit: "month", day: 1, hour: 9, minute: 0, first_day: true };
  }
  m = s.match(/^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (m) {
    const weekday = WEEKDAYS[m[1]];
    let hour = m[2] !== undefined ? Number(m[2]) : 9;
    const minute = m[3] !== undefined ? Number(m[3]) : 0;
    const ap = m[4];
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    return { kind: "calendar", calendar: "weekly", value: 1, unit: "week", weekday, hour, minute };
  }
  return null;
}

// "every 30 days" and "every 90 days" are ambiguous with calendar month /
// quarter. Attach the ambiguity to the parsed result.
function attachAmbiguity(parsed, raw) {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (parsed && parsed.kind === "elapsed" && parsed.unit === "d" && parsed.value === 30) {
    parsed.ambiguous = "month";
  }
  if (parsed && parsed.kind === "elapsed" && parsed.unit === "d" && parsed.value === 90) {
    parsed.ambiguous = "quarter";
  }
  return parsed;
}

function cloudFailureNames(ctx) {
  const f = [];
  if (ctx.user_accepts_cloud !== true) f.push("user_accepts_cloud");
  if (ctx.target_available_from_cloud_clone !== true) f.push("target_available_from_cloud_clone");
  if (ctx.no_local_only_files !== true) f.push("no_local_only_files");
  if (ctx.kaizen_available_in_cloud !== true) f.push("kaizen_available_in_cloud (a cloud Routine would later report skill not found)");
  if (ctx.requires_local_9router !== false) f.push("requires_local_9router");
  return f;
}

function calendarSpec(p) {
  if (p.kind !== "calendar") return null;
  const spec = { hour: p.hour, minute: p.minute };
  if (p.weekday !== undefined) spec.weekday = p.weekday;
  if (p.day !== undefined) spec.day = p.day;
  if (p.months !== undefined) spec.months = p.months;
  return spec;
}

function actualCadence(p, mechanism) {
  if (p.kind === "calendar") {
    if (p.calendar === "weekly") {
      const name = Object.keys(WEEKDAYS).find((k) => WEEKDAYS[k] === p.weekday) || "monday";
      return `calendar weekly (${name} at ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")})`;
    }
    if (p.calendar === "monthly") {
      return `calendar monthly (Day=${p.day} at ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")})`;
    }
    if (p.calendar === "quarterly") {
      return `calendar quarterly (Months [${p.months.join(",")}], Day=${p.day} at ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")})`;
    }
  }
  const unitWord = { m: "minute", h: "hour", d: "day", week: "week", s: "second" }[p.unit] || p.unit;
  const plural = p.value === 1 ? unitWord : `${unitWord}s`;
  const suffix = mechanism === "/loop" ? " via /loop (expires after 7 days)" : ` via launchd StartInterval (${p.total_seconds} seconds)`;
  return `every ${p.value} ${plural}${suffix}`;
}

function decide(rawInput, context) {
  const raw = rawInput;
  const p = attachAmbiguity(parseInterval(raw), raw);
  if (!p) {
    console.log(JSON.stringify({ ok: false, error: "unparseable interval", input: raw }, null, 2));
    process.exit(2);
  }

  const ctx = context || {};
  const isShort = p.kind === "elapsed" && p.total_seconds <= 3600;
  const isMultiDay = !isShort;
  const cloudFailures = cloudFailureNames(ctx);
  const cloudEligible = cloudFailures.length === 0;
  const sessionStaysOpen = ctx.session_will_stay_open === true;
  const durable = ctx.durable === true;
  const usesClaudeNine = ctx.uses_claude_nine === true;
  const askedForCloud = ctx.requested_mechanism === "cloud" || ctx.user_accepts_cloud === true;

  let mechanism = "launchd";
  let clarification = false;
  let question = "";
  let reason = "";

  if (p.ambiguous === "month") {
    clarification = true;
    question = "Exactly every 30 days, or once each calendar month?";
  } else if (p.ambiguous === "quarter") {
    clarification = true;
    question = "Exactly every 90 days, or once each calendar quarter?";
  }

  if (isShort && sessionStaysOpen) {
    mechanism = "/loop";
    reason = `${p.value}${p.unit} is a short session cadence and the session is known to stay open, so a /loop schedule fits; /loop recurring tasks expire after seven days.`;
  } else if (isShort) {
    mechanism = "launchd";
    reason = `${p.value}${p.unit} is a fast cadence; without a confirmed open session a durable local launchd job is recommended (durable=${durable ? "true" : "unset"}). /loop is only used when session_will_stay_open is true.`;
  } else if (usesClaudeNine && cloudEligible) {
    mechanism = "launchd";
    if (!clarification) {
      clarification = true;
      question = "Keep the local 9Router or cloud?";
    }
    reason = "Cloud scheduling is eligible, but this box routes through claude-nine/9Router; defaulting to the local launchd route until the user chooses.";
  } else if (cloudEligible && askedForCloud) {
    mechanism = "cloud-schedule";
    reason = "All cloud conditions hold (user accepts cloud, target reachable from a cloud clone, no local-only files, kaizen available in cloud, no local 9Router requirement), so a durable cloud Routine fits.";
  } else if (askedForCloud && !cloudEligible) {
    mechanism = "launchd";
    if (!clarification) {
      clarification = true;
      question = `Cloud scheduling is not available here (${cloudFailures.join(", ")}). Use a local launchd schedule instead?`;
    }
    reason = `Cloud was requested but cloud scheduling is not eligible: ${cloudFailures.join(", ")}. Recommending the local launchd path instead.`;
  } else if (isMultiDay) {
    mechanism = "launchd";
    if (cloudEligible) {
      reason = "Durable multi-day cadence with cloud eligible but not requested; defaulting to the local launchd schedule.";
    } else if (cloudFailures.includes("kaizen_available_in_cloud (a cloud Routine would later report skill not found)")) {
      reason = `Cloud scheduling is not eligible because kaizen_available_in_cloud is false — a cloud Routine would later report skill not found. Recommending launchd.`;
    } else {
      reason = `Durable multi-day cadence; cloud scheduling is not eligible (${cloudFailures.join(", ")}), so a local launchd job is recommended.`;
    }
  } else {
    mechanism = "launchd";
    reason = "Local durable schedule via launchd.";
  }

  if (ctx.requested_mechanism === "desktop-task" && ctx.desktop_task_available === true && isMultiDay && !cloudEligible) {
    mechanism = "desktop-task";
    reason = "A local Claude Desktop scheduled task was requested and is available; it survives restarts and sees local skills.";
  }
  if (ctx.requested_mechanism === "manual") {
    mechanism = "manual";
    reason = "The user asked for a manual schedule; provide the exact command or reminder steps.";
  }

  const isLoop = mechanism === "/loop";
  const isCloud = mechanism === "cloud-schedule";
  const preserves9router = isCloud
    ? ctx.requires_local_9router === false && ctx.user_accepts_cloud === true
    : true;

  let roundingNote = "";
  if (p.ambiguous === "month" && p.kind === "calendar") {
    roundingNote = " \"monthly\" is mapped to a calendar month (Day=1 at 09:00), not a fixed 30-day interval — the actual cadence follows the calendar.";
  } else if (p.ambiguous === "quarter" && p.kind === "calendar") {
    roundingNote = " \"quarterly\" is mapped to calendar quarters (Months 1,4,7,10), not a fixed 90-day interval — the actual cadence follows the calendar.";
  }

  const explainParts = [];
  if (isLoop) {
    explainParts.push(`Run every ${p.value} ${p.unit} with /loop while the session stays open; this expires after seven days.`);
  } else if (isCloud) {
    explainParts.push("Run in the cloud on a persistent Routine; the machine does not need to be on.");
  } else if (mechanism === "launchd") {
    explainParts.push("Run locally with a launchd LaunchAgent; the machine must be on at run time.");
  } else if (mechanism === "desktop-task") {
    explainParts.push("Run locally with a Claude Desktop scheduled task; the machine must be on at run time.");
  } else {
    explainParts.push("Run manually; give the user the exact command.");
  }
  if (clarification) explainParts.push(`Ask: "${question}"`);

  const out = {
    ok: true,
    requested_cadence: raw,
    normalized_interval: { value: p.value, unit: p.unit },
    cadence: p.kind === "calendar" ? "calendar" : "exact_elapsed",
    total_seconds: p.total_seconds !== undefined ? p.total_seconds : null,
    calendar_spec: calendarSpec(p),
    clarification_required: clarification,
    clarification_question: question,
    recommended_mechanism: mechanism,
    reason: reason + roundingNote,
    machine_on_required: !isCloud,
    open_session_required: isLoop,
    local_file_support: isCloud ? ctx.no_local_only_files === true : true,
    cloud_eligible: cloudEligible,
    cloud_ineligible_reason: cloudEligible ? "" : cloudFailures.join(", "),
    preserves_9router: preserves9router,
    skill_availability_required: isCloud,
    expires_after_seven_days: isLoop,
    expiry_days: isLoop ? 7 : null,
    actual_cadence: actualCadence(p, mechanism),
    explain: explainParts.join(" "),
  };
  console.log(JSON.stringify(out, null, 2));
}

const { input, context, contextError, error } = parseArgs();
if (error) {
  console.log(JSON.stringify({ ok: false, error, input: null }, null, 2));
  process.exit(2);
}
if (contextError) {
  console.log(JSON.stringify({ ok: false, error: `invalid --json-context: ${contextError}`, input }, null, 2));
  process.exit(2);
}
decide(input, context);
