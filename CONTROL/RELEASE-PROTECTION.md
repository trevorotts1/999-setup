# Candice Release Protection

Candice distribution is blocked by default. The only allowed publication path
is a release workflow that executes:

```sh
node scripts/candice-release/status.mjs
```

on the exact tagged commit, with no environment override. A nonzero exit is a
hard release failure. The command is also required in `candice-ci` for every
`candice-v*` tag.

Repository administration must additionally restrict creation of `candice-v*`
tags and GitHub Releases to the release owner/workflow identity. A manually
created tag is not publish authorization: the CI release-authority job blocks
artifact publication and the operator release authority remains unconfigured
until FIX-024 independent approval.

The current 0.2.0 application payload records are audit-only quarantine data,
not active updater content. A new application payload may be added only by
FIX-022 after all required evidence exists.
