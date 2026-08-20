# How to get back to Kaizen — <Friendly Loop Name>

## After a restart

Open Terminal and type:

```text
<launcher> --resume <friendly_session_name>
```

(This works only if that named session exists. If it does not, just open
`<launcher>` and type `/kaizen run <loop-id>`.)

## Does the schedule restart automatically?

<yes — LaunchAgent/Desktop task reloads on login | no — /loop is
session-scoped and must be rearmed | n/a — cloud Routine, nothing local>

## Does the machine need to be on?

<yes, at run time | no — cloud Routine>

## Does the original Claude session need to be resumed?

<yes, within the 7-day /loop expiry | no — Memory is the continuity layer>

## Run one cycle manually

In any session:

```text
/kaizen run <loop-id>
```

## Where Memory lives

```text
<absolute path to this Loop folder>
```

## See status

```text
/kaizen status <loop-id>
```

## Stop or pause

```text
/kaizen pause <loop-id>   (keep Memory, stop scheduling)
/kaizen stop <loop-id>    (stop scheduling, keep Memory)
```
