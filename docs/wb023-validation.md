# WB-023 — Phase-controlled CLI deadline verification

Date: October 21, 2026 (America/New_York). **Test-only milestone complete.**
The deployed runtime remains **0.16.3-dev / WB-022**, with **52 tools** and six shared command slots. There is no WB-023 runtime release, version bump, rebuild, restart or activation.

## Why this work was needed

WB-022 retained a failed installed test that assumed a workflow had already started when a one-second CLI deadline expired. Its unchanged isolated and full reruns passed, but that did not repair the assumption. WB-023's negative control withheld submission in a private CLI until its real deadline. The original test then failed with pending versus validating, reproducing the assumption without changing production code. This controlled reproduction does not establish the precise scheduling cause of the earlier intermittent incident.

## What changed

Only test/workflow-cli.test.mjs changed outside documentation. The old deadline test was replaced by a preaccepted-job case and two additional phase-specific cases:

1. **Already accepted:** record the original job ID and observe a real child marker before starting the same one-second caller deadline. A release file, not a racing three-second sleep, controls command completion. The original job and owner must survive, and a later client must complete that exact attempt.
2. **Not submitted:** a private CLI preload holds the request before submission until the real deadline. The workflow must remain pending with zero attempts, no child side effect, unchanged journal bytes and no later batch write. A later normal invocation executes exactly once.
3. **Accepted response withheld:** the private caller submits normally, records the actual accepted response, then withholds its delivery until the real deadline. The next caller must find the same owned job and finish it once, without a second attempt.

Both injected cases require their observed phase and workflow identity. Their five-second caller budget allows ordinary setup; phase observations, not elapsed time, determine what was tested. The accepted-job case retains its original one-second caller deadline. All three verify exit 124, no automatic retry, stopped batch continuation, stable owner/job identity and byte-preserving completed-job replay. The fixture wait helper now honors completionPending and child CLI processes have bounded output and parent deadlines.

No timeout is mocked, no production hook is installed, and no test is skipped to obtain a pass. Finite fixture/setup bounds remain: this is not a guarantee that every overloaded or unavailable environment can run tests successfully.

## Verification

| Check | Observed result |
| --- | --- |
| Controlled original assertion | Expected failure reproduced; actual underlying test exit 1 retained |
| Isolated revised full suite | 475/475 passed |
| Main repository against unchanged installed modules | 475/475 passed; no rebuild |
| Production-only workflow suite | 8/8 passed; includes all three deadline cases |
| Repeated deadline verification | Four runs, at most two concurrently; 12/12 scenario executions passed |
| Formatting | Passed |
| Live browser / installed shared CLI | Original accepted attempt survived deadline and completed once |

The full count grew from 473 to 475 because one existing case became three. Production and repeated checks are subsets/repetitions, not additional unique regression tests. The repeated runs overlapped the isolated full suite. Tests ran on the user's Windows host with Node v26.5.0 and the project's unchanged pinned dependencies. The production-only fixture reused verified same-version production dependencies and lacked application source, TypeScript and Prettier. No network installation was needed.

## Live acceptance and preservation

Direct Workbridge workflow_resume launched wb023-hosted-workflow-20261021-01. Its original job was wf-6fde06603276798c498408f3b5aa7377-0-0. After the installed CLI returned deadline exit 124, a fresh direct workflow_status still showed that same job running, completionPending true and exactly one attempt. Explicit release let the original command finish with exit 0. Later CLI reconciliation/replay did not execute again.

Counter, target, unrelated dirty fixture contents and Git staging were restored; the two temporary markers were removed with hash guards and the patch was explicitly undone. The completed job record stayed unchanged. Private request/response withholding was not used against the live service, and no live journal or transport was damaged.

The service owner remained d7ca7bc4-79c7-4588-b421-518a0dd5253c. Final evidence checks the 2,808 deployed runtime-file hashes, original sealed payload, six configuration hashes, main Git index and expected source changes. Inspect final-verification.json and milestone-complete.json for actual final results. No new seven-gate runtime release was needed or claimed for this test-only change; WB-022's sealed release and historical evidence remain untouched.

## Resume and evidence

Evidence directory: C:\work\workbridge-wb023-20261021-01\evidence.
Test patch: wb023-test-promotion-20261021-01.
Documentation patch: wb023-documentation-20261021-01.
Final validation workflow: wb023-final-checkpoint-20261021-01.

The complete test and documentation diffs were reviewed by the implementing assistant, not an independent reviewer. No main staging, commit, push, dependency, credential, permission or unrelated-project change was made. The inherited direct named command_retry_save exposure check and browser-rendering limitations are not addressed here.

Resume from [the handoff](handoff-20261020.md). Do not repeat WB-022 activation or the fixed acceptance IDs. For a fresh manual test from PowerShell in C:\work\workbridge-mcp, run:

```powershell
node --test --test-name-pattern "CLI deadline" test/workflow-cli.test.mjs
```

Model: GPT-6 Astra Pro. Reasoning level:
