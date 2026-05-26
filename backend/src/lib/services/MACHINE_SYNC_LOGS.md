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
