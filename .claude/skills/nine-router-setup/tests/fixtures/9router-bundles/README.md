# 9Router bundle excerpts

Verbatim excerpts of the npm-published `9router` prebuilt bundle (`app/.next-cli-build/server/chunks/*.js`, MIT licence,
https://www.npmjs.com/package/9router), taken with `npm pack 9router@<version>` and never installed. Each file is the
bytes of one webpack module (or one function) from the real chunk, wrapped in `exports.modules={...}` only so it parses.
They are what the guards' content anchors are tested against in `tests/test-9router-guards-new-bundles.sh`.

| file | what it is |
|---|---|
| `converter.js` | stream converter module 71857 (`new TextEncoder`, `translate`/`passthrough`, `transform`, `flush`) — ollama-done and ollama-stream-error |
| `combo.js` | combo module (`18910` up to 0.5.104, `25308` from 0.5.109), export `Pr` — failover guard, ollama-overload guard |
| `resolver.js` | model resolver module 38775, export `mA` — required by the two guards above |
| `nonstream.js` | non-stream response module 5016 — ollama-overload guard, part B |
| `effort.js` | the `case"deepseek"` branch of the thinking serializer — deepseek-effort |
| `serializer.js` | the thinking-intent helpers and the applier function — GLM 5.3 guard, part D |

Versions: `0.5.104` (last version the guards were written against), `0.5.111`, `0.5.112`. For 0.5.111 only `effort.js`
and `serializer.js` differ from 0.5.112 (the serializer call has six arguments up to 0.5.111, seven from 0.5.112); the
0.5.111 converter and combo modules are byte-identical to 0.5.112's (compared with `cmp` when these fixtures were cut),
so the test runs 0.5.111 against the 0.5.112 copies of those.
