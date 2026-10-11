# Existing editor configuration event diagnosis

[Issue #8371](https://github.com/ubugeeei-prod/vize/issues/8371) remains
unqualified for the original configuration content-change host control.
The exact composed source `fc4c7a8e43f2480b856e19baf4bf02c1c0f58918`
failed [full Check 38112485518](https://github.com/ubugeeei-prod/vize/actions/runs/38112485518)
at `existing-config-smoke.cjs:124`: an existing nested
`packages/app/tsconfig.app.json` edit did not restart the mocked LSP with
`typecheck: false`. The original 20-second deadline and 100-ms polling
remain unchanged. This is a mocked-host refusal; the real host and later
editor consumers were skipped.

The original failure upload only covered the real host, which had not
started. No complete mocked event artifact exists; the raw failed job
retains only the last ten events. That evidence does not prove whether
the native event was lost, the glob filtered it, or the lifecycle failed.
The isolated diagnostic retains the full mocked event log and controlled
workspace at failure, records original configuration watcher callbacks,
and compares passive broad and named-tsconfig observers. These observers
make no server requests and change no expectations or deadlines.

The diagnostic starts from exact config bottom
`04b15e087766bfcf29662b01e829fa79c1931100`, whose editor source is preserved
in the failed composition. Its temporary hosted workflow executes only
the unchanged original editor-host job and complete editor composite; it
is not a complete Check qualification and must not enter the merge queue.
The temporary probes and scoped workflow will be excluded from any source
fix handed to the config owner. A production cause and the original
positive and refusal controls must be qualified before readiness.
