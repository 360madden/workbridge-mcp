# Versioned desktop provider interface — implementation proposal

Status: **source-audited design only**, November 4, 2026. No production implementation, deployment, GUI/COM or guest input is authorized by this document. This proposal deliberately keeps Workbridge running normally while competing desktop backends are evaluated independently.

## Decision

Keep Workbridge as the only coordination, authority, evidence and recovery owner. Allow a selected desktop *function* to use Microsoft WinApp CLI 0.7.1, `sbroenne/mcp-windows` or `eugman/FlaUI-MCP-Core` behind a pinned provider adapter when that function wins a measured comparison. Do not replace unrelated Workbridge command/workflow/agent infrastructure. No provider may bypass the shared input turn, issue arbitrary global input, or report semantic success solely from its tool acknowledgment.

**Do not vendor-spoof WinApp in a generalized guard.** The current guard intentionally hard-codes the observed WinApp backend/version; a different provider must remain distinguishable through its complete evidence chain.

## Verified source seams and limits

| Existing source/function | Reuse | Gap to address before integration |
| --- | --- | --- |
| `src/desktop-action-guard.ts:7-23` `DesktopActionTarget` | Exact PID, HWND, process, title, class, process start and session identity | Keep this as the common target; add trusted provider provenance without weakening target checks |
| `src/desktop-action-guard.ts:353-433` `previewDesktopAction` | Fresh native observation → read-only UIA inspection → fresh native observation; geometry, foreground, visibility, uniqueness and max-age checks | `assertUia` at 270-349 assumes WinApp 0.7.1; factor out a canonical tree validator accepting an **internally pinned** provider, preserving the existing WinApp default path |
| `src/desktop-action-policy.ts:256-268,327-425` `planDesktopProbeAction` / `verifyDesktopProbeActionAuthorization` | Pure dry-run request hashing, trusted context/approval/lease observations and 2-second/5-second freshness | Fixed synthetic `IncrementButton` policy, no action dispatch; general action intent must bind provider identity/operation/postcondition while leaving pilot hashes untouched |
| `src/desktop-action-postcondition.ts:91-149,190-333` `verifyDesktopProbeActionPostcondition` | Pure exact-once native counter verification and wall/monotonic event ordering, full lease fence, pre/post desktop evidence | Only the synthetic counter proof; add application-specific trusted observers, **not** a generic `success: true` claim; do not duplicate this existing validator |
| `src/desktop-registration.ts:36-140` `withDesktopCaptureTurn` | Exclusive `wx` `desktop-input-turn.lock`, immutable owner stamp, quarantine of unsettled tree | Evolve into a single Workbridge-owned GUI turn used by **all providers** and focus-affecting capture; fill owner process start/session and preserve fail-closed recovery |
| `src/desktop-cli-runner.ts:69-185` `createDesktopPrototypeInvoker` | Four allowlisted scripts, sanitized env, bounded args/output and 45-second deadline | Direct Node wrapper kill does not prove nested WinApp descendants stopped; expose a supervised backend invocation only after an isolated native-host test |
| `scripts/Desktop-JobLifetime.cs:65-117` `DesktopJobLifetime.Attach` / `ActiveProcesses` | Private non-inherited kill-on-close Windows Job Object and verified active-process count | Reuse in a tiny dedicated test host; do not put arbitrary Workbridge commands or its long-lived server inside that job |
| `src/desktop-registration.ts:207-279` `registerDesktopTools` | Narrow `desktop_windows`, `desktop_inspect`, `desktop_capture_window`, `desktop_capture_vmware_host` | Feature-gate per-function provider selection; generic action endpoints remain unregistered until separately authorized and tested |

The current VMware capture path is **host-window evidence**, not proof of guest receiver readiness or guest input. `previewDesktopAction` deliberately rejects VMware and browser/ChatGPT targets; preserve those route boundaries.

## Smallest new contract (proposal)

Create one new internal module, tentatively `src/desktop-provider-contract.ts`, with Zod-validated schema version 1 and immutable records. An internal registry, not the MCP caller, pins the executable/MCP-server source and digest. A candidate's public MCP tool description never grants control authority.

```ts
type DesktopProviderIdV1 =
  | 'microsoft-winapp-cli'
  | 'sbroenne-mcp-windows'
  | 'eugman-flaui-mcp-core';

type ExactWindowV1 = DesktopActionTarget; // Existing seven exact identity fields.

type ProviderManifestV1 = Readonly<{
  schemaVersion: 1;
  providerId: DesktopProviderIdV1;
  version: string;                // Observed executable/server version.
  buildSha256: string;            // Verified package/executable manifest digest.
  capabilities: readonly ('windows' | 'inspect' | 'capture-window' | 'uia-invoke')[];
}>;

type ActionIntentV1 = Readonly<{
  schemaVersion: 1;
  requestId: string;
  requestHash: string;            // Canonical hash: target+provider+verb+expected effect.
  provider: ProviderManifestV1;   // Pinned at planning/approval; no late substitution.
  target: ExactWindowV1;
  verb: 'uia-invoke';             // Start narrowly; no unrestricted mouse/keyboard.
  selector: string;
  controlType: string;
  expectedPostcondition: {
    kind: 'trusted-native-counter' | 'trusted-file-hash' | 'trusted-app-receipt';
    observerId: string;           // Workbridge allowlist, never caller file path or code.
    expectedDigest: string;
  };
  fence: {
    ownerId: string;
    contextId: string;
    contextRevision: number;
    leaseId: string;
    generation: number;
    resource: 'desktop-input';
    hostSessionId: number;
  };
}>;

type ProviderDispatchV1 = Readonly<{
  schemaVersion: 1;
  requestId: string;
  requestHash: string;
  providerId: DesktopProviderIdV1;
  providerCallId: string;
  dispatchState: 'not-started' | 'entered' | 'indeterminate';
  providerReturn: 'accepted' | 'rejected' | 'timeout' | 'crash' | 'none';
  startedAtMonotonicMs: number;
  completedAtMonotonicMs: number | null;
  reportedHwnd: number | null;
  jobOwnerPid: number | null;
  treeSettlement: 'settled' | 'unsettled' | 'not-started';
}>;

type DesktopOutcomeV1 = Readonly<{
  schemaVersion: 1;
  requestId: string;
  requestHash: string;
  target: ExactWindowV1;
  providerId: DesktopProviderIdV1;
  fence: ActionIntentV1['fence'];
  state: 'blocked' | 'pending' | 'verified_success'
       | 'verified_failure' | 'unknown_outcome';
  reasonCode: string;
  retryAllowed: boolean;
  dispatchReceiptRef: string | null;
  evidence: {
    beforeRefs: readonly string[];
    afterRefs: readonly string[];
    independentPostconditionRef: string | null;
    screenshotSha256: string | null; // Pixel evidence, never sufficient by itself.
  };
  treeSettlement: 'settled' | 'unsettled' | 'not-started';
  finalizedAtUtc: string | null;
}>;
```

The source types above are a specification, **not installed or compiled code**. Keep vendor-specific raw UIA trees private; normalize into a common bounded canonical tree (`selector`, control type, enabled/invokable/offscreen flags, bounds, exact HWND) with a strictly verified provider ID/version/digest. Do not rewrite vendor metadata to `Microsoft.WinAppCli` to pass existing guards. Preserve the full observed provenance beside canonical evidence.

### Interface and file-level changes (not yet implemented)

1. **New `src/desktop-provider-contract.ts`** — the above strict Zod schemas, bounded field sizes, canonical hash and state invariants. Initially private/offline only.
2. **New `src/desktop-provider-normalizer.ts`** — three allowlisted adapters that parse and bound vendor output, distinguish actual provider identity and return normalized read-only tree evidence. Importantly, it does *not* authorize action or claim the vendor succeeded.
3. **Existing `src/desktop-action-guard.ts`** — factor only the pinned WinApp evidence check into a canonical provider-aware validation seam; default WinApp path retains exact current assertions. Never loosen immutable seven-field target, geometry, 2-second freshness or protected-target rejections.
4. **Existing `src/desktop-cli-runner.ts` plus a tiny `scripts/Desktop-Provider-Host.cs`** — for subprocess-capable providers, use already tested `Desktop-JobLifetime.cs` to launch allowlisted commands under Job Object ownership; wait for complete process-tree settlement before claiming a returned operation is finished. Keep the current allowlist and its Node wrapper as the default/fallback until verified.
5. **Existing `src/desktop-registration.ts`** — no new arbitrary input tool. First internally select a provider only for read-only `desktop_windows`/`desktop_inspect`; eventually focus/capture/action operations pass through one shared Workbridge GUI turn and one authoritative request journal.
6. **Existing `src/desktop-action-postcondition.ts`** — unchanged for the tested synthetic probe. A separate small verifier delegates to an allowlisted independent observer and references the existing policy/fence rules; it does not accept user-supplied success booleans.

A long-lived external MCP daemon is **not** automatically process-isolated merely because an individual MCP call times out. It requires its own supervised lifetime and reconciliation proof before it can own input. The initial implementation should prefer the already-installed CLI baseline and evaluate persistent candidate providers separately.

## Single-owner action lifecycle

1. Discover the exact target read-only; independently confirm process creation time, HWND, process name, class, session, foreground/visibility/monitor geometry and locked-desktop state.
2. Normalize bounded UIA evidence from a **registry-pinned** provider. Preview never grants execution authority.
3. Acquire the existing Workbridge `desktop-input-turn.lock` exclusively, with a durable owner stamp including process PID, **process start**, host session, request hash, target and increasing generation. All providers and focus-affecting captures use this one resource; 36 command slots are **not** 36 desktop-input owners.
4. Recheck trusted context/approval/lease, target identity and short-lived observations immediately before dispatch. Persist immutable intent and expected postcondition **before** entering the provider.
5. Invoke at most once inside the supervised worker. Record provider ACK separately from semantic outcome. A timeout/cancel/crash is never an assumed failure or permission to retry.
6. Confirm Job Object `ActiveProcesses()==1` while its host remains alive after descendants exit, or after owner death confirm the identified child lifetime ended. On an unverified tree, quarantine the GUI turn; do not reclaim merely by elapsed lock age.
7. From Workbridge-owned independent observers, collect native events/file changes/app receipts with complete before/after interval and matching request, full process lifetime identity, host session and lease generation. A changed PNG hash proves pixel difference only, not semantic success.
8. Publish a versioned outcome receipt atomically. Same request ID returns its stored receipt; uncertain IDs remain reconciliation-only, never an automatic second dispatch.

### Outcome and retry rules

| State | Required proof | Retry |
| --- | --- | --- |
| `blocked` | Fresh policy/lease/session/target rejection **before dispatch**, with durable non-dispatch proof | Replan under fresh identity and a new approved request |
| `pending` | Leased, in flight or dialog still awaiting an independently observed terminal state | No resending |
| `verified_success` | Trusted independent exact postcondition, matching target and lease, no duplicate effect | No; replay receipt only |
| `verified_failure` | Independent terminal evidence of no effect **and** no possible delayed/queued work | Default no; a separately approved new action after revalidation |
| `unknown_outcome` | Dispatch uncertain, worker hung/crashed, tree unsettled, incomplete/contradictory evidence or possible delayed effect | **Never auto-retry**; quarantine/reconcile |

Important: **Job settlement and outcome verification are different facts.** Terminating the WinApp/FlaUI client cannot undo an effect already applied inside the target app. For real third-party programs, an unchanged screenshot or missing private marker generally does not prove `verified_failure`; use `unknown_outcome` without authoritative negative evidence.

### Failure cases to test

| Code family | Observable case | Safe behavior |
| --- | --- | --- |
| `STALE_TARGET` / `FOREIGN_HWND` | HWND reused, PID lifetime changed or child HWND belongs to another top-level owner | Block before dispatch; refresh target |
| `SESSION_NOT_READY` / `FOREGROUND_MISMATCH` | Locked session, focus stolen, minimized window, DPI/offscreen coordinates | Block/no physical input |
| `SELECTOR_NOT_UNIQUE` / `CONTROL_NOT_READY` | Duplicate labels, disabled or offscreen element | Block; no fallback click |
| `UI_TURN_BUSY` / `LEASE_FENCE_MISMATCH` | Two or six agents/providers collide | One owner; others wait/replan |
| `PROVIDER_TIMEOUT` / `DESKTOP_TREE_UNSETTLED` | COM hangs, child process survives wrapper timeout | Retain intent, quarantine until supervised settlement |
| `POSTCONDITION_MISMATCH` | Vendor says success but no independent effect, unexpected duplicate event | `unknown_outcome` unless terminal non-effect is proven |
| `MODAL_PENDING` | Dialog appears late or remains open while Invoke hangs | `pending`/unknown, no blind second click |
| `VM_GUEST_UNVERIFIED` | VMware host frame visible but guest receiver not authenticated | No guest command; retain separate host/guest evidence |

## Minimal implementation and release roadmap

| Gate | Scope | Acceptance/rollback |
| --- | --- | --- |
| **D0 Offline contract** | New types, normalization fixtures and exact request hashing in isolated tests | Existing WinApp guard/policy/postcondition tests unchanged; no service impact |
| **D1 Native containment** | Reuse `Desktop-JobLifetime.cs` with a tiny dedicated host; only synthetic blocked descendants | Already tested prototype: `reliability_synthetic_hang_p1_20261104_001`, 1/1 pass with active Job members 2 and independent outcome journal; still **not a UIA test** |
| **D2 Read-only three-provider comparison** | Identical disposable target enumeration/inspection, cold/warm median/p95, modal/stale-target and output limits | Version/digest pinned; no production input; fail closed if process/lease settlement uncertain |
| **D3 Private action acceptance** | Disposable app only, one semantic Invoke, six-client lease contention, hung-before/after effect, focus change | Zero wrong targets, zero duplicate effects, independent before/after receipt; any unproved case blocks promotion |
| **D4 WB-001 candidate** | Seal exact sources/build of native host and optional provider registry; feature toggle defaults to current WinApp implementation | Verify current running owner/runtime/catalog identity first; pass isolated suite, full gates, rollback rehearsal and private MCP acceptance. A matching version string alone is not provenance |
| **D5 Separately approved activation** | Opt-in a single read-only function initially; retain legacy tool as a pinned fallback | Post-deploy status/capture and health checks; on regression, disable new provider or use WB-001's sealed previous runtime rollback—never force-restart owner or bypass failed preflight |

Production action APIs, unattended desktop focus, broad key/mouse injection, live VMware guest commands and RIFT input are **outside this design-only step**. Do not let an experimental provider take over Workbridge startup or its 36-slot scheduler. Require a separate authorization and staged release decision for each of those expansions.

## Current experimental evidence

- Original native Job Object smoke: `reliability_joblifetime_20261104_001`, exit 0, 1/1 passed, noninherited job owner and descendant lifetime observed.
- Synthetic hang/effect prototype: `reliability_synthetic_hang_p1_20261104_001`, exit 0, 1/1 passed, native Job accounting showed owner+child, child alive just before termination and gone afterward, independent effect receipt reconciled.
- Both tests used uniquely owned temporary artifacts; neither exercised COM/UIA or changed production.
- Residual risks: actual provider hangs, persistent MCP daemon lifetime, process PID reuse in a longer-running system, genuine modal recovery, and live guest observations remain unproven.
