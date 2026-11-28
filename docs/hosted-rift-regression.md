# Hosted RIFT regression partition

The hosted Windows/Node 24 lane runs four existing RIFT companion suites without a RIFT installation, game login, local Python environment, or archived game executable. It uses only synthetic observations and disposable receipt files. This is not a live-client acceptance gate.

From a Workbridge checkout, run:

```powershell
node scripts/ci-rift-test-runner.mjs inventory
node scripts/ci-rift-test-runner.mjs hosted
```

The inventory command works on any Node platform. The hosted test command intentionally requires Windows because the selected tests validate Windows path and executable identity contracts.

The inventory must classify every `integrations/rift/test/*.test.mjs` file exactly once. New, renamed, removed, or non-regular test entries fail the gate rather than silently reducing coverage. Ten existing host-dependent suites remain in the unchanged full `npm test` and WB-001 acceptance paths. No live deployment or runtime change is implied by passing this hosted partition.

A hosted pass validates only the fixture assertions; it cannot establish current RIFT availability, a process identity, real telemetry, or successful game interaction.

## Independent CI job

The dedicated `rift-offline` Windows job runs without installing npm dependencies or building native Workbridge components. It checks the inventory regressions and then executes the hosted partition. It does not depend on the two core jobs, so a failure in an unrelated core suite cannot suppress offline RIFT evidence. All three jobs must be considered when assessing a complete hosted CI run.
