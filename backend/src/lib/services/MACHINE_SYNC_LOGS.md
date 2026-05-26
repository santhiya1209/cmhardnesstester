# Machine Control sync — log sequence troubleshooting

Two-way sync for **Force**, **Lightness**, **Load Time** is logged end-to-end.
Use the console logs to confirm where a sync breaks. No fallback exists — if a
step is missing, that step is the fault.

## 1. PC software value change (PC → Machine)

Expected log order:

```
[machine-sync][pc-change]   field=<field> value=<value>
[machine-tx]                field=<field> command=<raw command>
[machine-rx]                raw=<machine response>
[machine-ack]               field=<field> ok=true
[machine-sync][ui-state]    field=<field> value=<value>
```

## 2. Machine panel value change (Machine → PC)

Expected log order:

```
[machine-frame-assembled]   frame=<frame>           (split chunks reassembled)
[machine-rx]                raw=<machine response>
[machine-rx-parse]          field=<field> value=<value>
[machine-sync][machine-change] field=<field> value=<value>
[machine-sync][ui-state]    field=<field> value=<value>
```

When a PC command is pending, the RX frame is also checked against it:

```
[machine-ack-match]         field=<field> expected=<v> received=<v> matched=true/false
```

Frame format reference (from the legacy Communication.dll protocol):
`UK0004`→`K0004` (lightness), `UT06`→`T06` (load time), `UL1`→`L1OK` /
`UL3`→`L3OK` (objective). Frames are reassembled from split serial chunks by the
RegexParser (`K` + `0004\r` → `K0004`) before `[machine-frame-assembled]`.

## Force (Cxx profile codes)

Force is exchanged as profile codes, not raw numbers:

```
C00=0.01kgf  C03=0.025kgf  C04=0.05kgf  C05=0.1kgf
C06=0.2kgf   C07=0.3kgf    C08=0.5kgf   C09=1kgf
```

- Machine panel → PC: `Cxx` frame → `[machine-force-map] direction=machine-to-pc
  frame=Cxx value=<value>` → `[machine-rx-parse] field=force …`.
- PC → machine: the command is the Communication.dll-confirmed
  `#<scale><value:D8>!` frame (NOT `UCxx`), logged as `[machine-force-map]
  direction=pc-to-machine value=<value> command=#<scale><value:D8>!`. The machine
  echoes `Cxx`, which the ack-match verifies against the expected force profile.
- An **unknown** `Cxx` code is logged (`[machine-force-rx] unknown force code…`)
  and **ignored** — never treated as ACK, so the previous confirmed value stays.

## Lightness (Kxxxx, range 0–10)

- Machine panel → PC: `Kxxxx` frame (e.g. `K0009`) → `[machine-lightness-map]
  direction=machine-to-pc frame=K0009 value=9` → `[machine-rx-parse] field=lightness …`.
- PC → machine: command `UKxxxx`, logged as `[machine-lightness-map]
  direction=pc-to-machine value=9 command=UK0009`; the machine echoes `K0009` and
  the ack-match logs `[machine-ack-match] field=lightness expected=K0009 received=K0009 matched=true`.
- An **invalid/out-of-range** `Kxxxx` is logged (`[machine-lightness-rx] invalid
  lightness frame…`) and **ignored** — never treated as success.

## Load Time (Txx, seconds)

- Machine panel → PC: `Txx` frame (e.g. `T04`) → `[machine-loadtime-map]
  direction=machine-to-pc frame=T04 value=4` → `[machine-rx-parse] field=loadTime …`.
- PC → machine: command `UTxx`, logged as `[machine-loadtime-map]
  direction=pc-to-machine value=4 command=UT04`; the machine echoes `T04` and the
  ack-match logs `[machine-ack-match] field=loadTime expected=T04 received=T04 matched=true`.
- An **invalid/out-of-range** `Txx` is logged (`[machine-loadtime-rx] invalid
  load-time frame…`) and **ignored** — never treated as success.

> Force note: the machine→PC code is `Cxx`, but the PC→machine command remains the
> Communication.dll-confirmed `#<scale><value:D8>!` frame (not `UCxx`). The machine
> still echoes `Cxx`, so the ack-match works either way.

## What a missing / failed log means

- **`[machine-tx]` missing** → the UI → preload IPC → backend path is broken
  (the command never reached the serial layer).
- **`[machine-rx]` missing** → COM / machine response issue
  (machine never replied, or the port is not receiving).
- **`[machine-ack] ok=false`** → command / ACK protocol issue
  (machine rejected or did not confirm; the previous confirmed value is kept).
- **`[machine-sync][ui-state]` missing** → frontend sync issue
  (state reached the renderer but the Machine Control UI did not commit it).

> Note: `[machine-sync][ui-state]` and `[machine-sync][machine-change]` are only
> emitted when the value actually changes (identical repeats are deduped), so a
> missing line for an unchanged value is expected, not a fault.
