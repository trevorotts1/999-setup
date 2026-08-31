# Third-Party Notices

This repository bundles third-party skills under
their respective licenses. Each vendored component folder carries a full copy
of its upstream license; this file records the upstream source and the exact
version/commit vendored, so licensing stays traceable.

## Vendored skills

The build spec selected these upstreams:

- `eli5` from [nathanksou/eli5](https://github.com/nathanksou/eli5)
- `bro` from [luchasarie/bro-skill](https://github.com/luchasarie/bro-skill)

Both upstreams exist, are Claude Code skills (`SKILL.md` present), and are MIT-licensed.
The vendored files were verified byte-identical (sha256) against the upstream trees at the
pinned commits below. No substitution occurred. An earlier revision of this file
misattributed the vendored content to `K-Paxian/eli5` and `K-Paxian/bro`; those
repositories do not exist on GitHub (checked via API, HTTP 404) and the attribution was
an error, now corrected.

| Skill | Owner-selected upstream | Actual vendored upstream | Vendored commit | License | Status |
|---|---|---|---|---|---|
| `eli5` | [nathanksou/eli5](https://github.com/nathanksou/eli5) | [nathanksou/eli5](https://github.com/nathanksou/eli5) (path `eli5/`) | `549364af799a4a0556c5359a0ac3e36d4da5719d` | MIT | MATCHES SELECTION |
| `bro` | [luchasarie/bro-skill](https://github.com/luchasarie/bro-skill) | [luchasarie/bro-skill](https://github.com/luchasarie/bro-skill) | `01e51f8092973be58eff3b7271282bd8488a02ae` | MIT | MATCHES SELECTION |

Files covered:

- `.claude/skills/eli5/SKILL.md` — MIT, see `.claude/skills/eli5/THIRD_PARTY_LICENSE.md`
- `.claude/skills/bro/SKILL.md` — MIT, see `.claude/skills/bro/THIRD_PARTY_LICENSE.md`
- `.claude/skills/bro/examples/*.md` (consultant-speak.md, git-panic.md, kubernetes.md,
  pt-br.md, software-architecture.md) — MIT, see `.claude/skills/bro/THIRD_PARTY_LICENSE.md`

All other skills in this repository (`nine-router-setup`, `spec-protocol`, `kaizen`) are
original to this repository and covered by the repository `LICENSE` (MIT).
