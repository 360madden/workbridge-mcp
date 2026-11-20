# Workbridge OpenAI Companion (experimental)

This **standalone** Node.js 24+ component adds a tested foundation for OpenAI Responses calls. It is **not installed into the live Workbridge owner**, does not restart the Secure MCP Tunnel, and has no RIFT or Windows input capability.

Roadmap: ../../docs/openai-api-agent-roadmap-20261120.md

## Current functions

- `doctor` — local Node, hostname, dependency and key-presence preflight. Prints boolean key presence only; **does not** inspect or output the key.
- `plan` — model/reasoning/token-limit selection and offline cost-exposure summary; no API calls.
- `run --live --input-file ...` — **one** bounded Responses API request with `store:false`, no automatic retries, explicit environment key, sanitized errors and receipt with actual token usage.
- No native Multi-agent, Workbridge tool invocation, background tasks, model-driven local command execution, or desktop action in this milestone. Those are separate roadmap gates.

### Install and test (PowerShell 7 on AMD-DESKTOP)

Run in `C:\work\workbridge-mcp\integrations\openai`:

```powershell
npm ci --ignore-scripts
npm test
npm run doctor
npm run plan -- --model gpt-6.2-astra --effort xhigh
```

### Optional paid live test (only after configuring API access)

Provide `OPENAI_API_KEY` through a trusted current-user setup outside the source repository. Do not put the key into a file under `C:\work` or pass it in command arguments.

Create a **temporary** UTF-8 text file inside the Workbridge repo (do not commit that file). Example: `C:\work\workbridge-mcp\temp\my-api-prompt.txt`. The companion refuses input outside the repository and reads at most 16 KiB.

In PowerShell 7, from this companion directory:

```powershell
node src/cli.mjs run --live --input-file "C:\work\workbridge-mcp\temp\my-api-prompt.txt" --model gpt-6.2-sol --effort medium --max-output-tokens 800
```

**Warning:** `--live` sends the input file contents to OpenAI and may incur API charges independently from ChatGPT usage. No API credit or key has been used by creating this code. The execution requires both explicit `--live` and a configured key; there is no automatic fallback, replay or retry. Limit is one request per invocation. It does not operate your desktop.

## Technical boundaries

- `openai@7.62.0` (official Node package; pinned for reproducibility, verify against the lockfile).
- GPT-6.2 Sol and Astra only; reasoning: `low`, `medium`, `high`, `xhigh`, `max`. No dynamic arbitrary base URL.
- Request cap: 16 KiB input and 128–2048 output tokens. API client timeout 30 seconds, zero SDK retries.
- Input files must be regular files inside the repository after real-path resolution.
- JSONL responses intentionally omit prompt bodies, keys, request payloads and raw provider errors. Successful live calls can print up to 12,000 characters of model output, which may itself contain sensitive material.
- The single-response call is not a substitute for idempotent job tracking. Do not blindly repeat a request after a timeout; provider processing or billing may already have occurred.
- Current CLI has no Workbridge access. Phase P2 will use authenticated local shared-service CLI to connect to the actual Workbridge owner, with read-only tool allowlists first.

## Official API references

- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/responses-multi-agent
- https://developers.openai.com/api/docs/guides/tools-computer-use
- https://developers.openai.com/api/docs/models/gpt-6.2-astra
