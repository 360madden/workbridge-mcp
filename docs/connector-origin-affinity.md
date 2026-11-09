# Browser-owned Workbridge connector affinity (2026-11-09)

## Current evidence

- Joey explicitly identified the **originating browser computer** for the current RR2 session as `AMD-DESKTOP`. The explicitly selected AMD Workbridge connector independently ran `hostname.exe` (exit 0, `AMD-DESKTOP`) on 2026-11-09. This is **execution-host** proof, not independently measured browser-host proof.
- AMD and LEGION are separately installed ChatGPT Workbridge connectors. ChatGPT can select either remote MCP endpoint; the browser computer is not an automatic routing parameter documented for these custom tools. OpenAI's custom MCP server and plugin guidance describes explicit app/tool choice and descriptions, not a physical-browser-host-to-connector guarantee.
- The already committed Workbridge server checks configured `expectedHostname` at startup and advertises `workspace_info.computerName` in source. The output schema and regression assertions were still uncommitted at investigation start. A fresh isolated build and live stdio MCP fixture on AMD passed and returned `computerName: AMD-DESKTOP`; **the currently connected production tool's `workspace_info` response still omits `computerName`**. Do not treat that source change as deployed.
- The connected-browser capability reported: `Browser access requires the originating browser context. Open ChatGPT in the browser with the connected extension and try again.` No browser-originating OS identity was independently read through it in this session.

## Practical acceptance contract

1. **Identify the browser origin first.** Use an independently browser-local OS identity channel (prefer supported connected-browser device identity, if exposed; otherwise a Chrome extension with a registered local native-messaging host). A remote Workbridge endpoint's `hostname.exe`, MCP name, or shared `C:\\work` path cannot establish the browser origin.
2. **Route through one explicit Workbridge selector.** A single user-facing router should choose AMD vs LEGION from the authenticated browser-origin signal and supply the intended host to the request. Do not rely on whichever similar connector the model first chooses.
3. **Enforce on every operation.** The selected endpoint checks its actual hostname against the intended browser-origin host and rejects unknown/stale/mismatched identity before local commands, file mutations, or RIFT control. No silent fallback to the other machine. Treat connection loss as unbound.
4. **Prove both directions.** From Chrome physically running on AMD-DESKTOP and LEGION, verify correct routing. Force an incorrect target in each case and prove **zero side effects**. Test disconnect/reconnect/new-chat and VM guest routing separately.

## Immediate safe operating mode

Until browser-origin plumbing and the single router exist, Joey's explicit current-host declaration plus a fresh `hostname.exe` result is the temporary guard. Pick the named connector intentionally and refuse mismatches. Do not claim the correct connector is *automatically* selected. The OpenAI browser connection and service deployment are separate gates; never restart the live owner merely to test source metadata.

References: https://developers.openai.com/api/docs/guides/custom-mcp-server ; https://developers.openai.com/plugins/deploy/connect-chatgpt ; https://learn.chatgpt.com/docs/extend/mcp
