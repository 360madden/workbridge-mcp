# Mandatory machine identity preflight

Before local work, verify the Workbridge connector's actual Windows hostname. Never infer it from a connector label, browser location, shared `C:\work` directory or previous chat. Physical hosts are `LEGION` and `AMD-DESKTOP`. If identity fails or is ambiguous, stop rather than switching connectors silently.

## VMware guests on AMD-DESKTOP

Use `C:\Program Files\VMware\VMware Workstation\vmrun.exe list` to confirm the exact running `.vmx` path. Check its `uuid.bios` from the `.vmx` file against this inventory before any VM-specific operation:

| Logical lab | Host | VMX path | BIOS UUID (VMX format) |
| --- | --- | --- | --- |
| RIFT-Lab-1 | AMD-DESKTOP | `C:\rift modding\VMs\RIFT-Lab-1\RIFT-Lab.vmx` | `56 4d c7 a3 99 ee e3 57-3d 9d 93 5b 4b f5 d8 56` |
| RIFT-Lab-2 | AMD-DESKTOP | `C:\rift modding\VMs\RIFT-Lab-2\RIFT-Lab.vmx` | `56 4d 48 19 3d e6 d1 b9-b4 e8 4a 94 7e 47 0c c2` |

These are host-side VM identities, **not verified guest Windows hostnames**. Guest identity must be obtained through an already-authorized guest receiver/VMware Tools channel before any guest-specific input. A VMware Tools command requiring a VM password is a blocker, not permission to guess or circumvent it. Reverify after cloning, restoring or relocating a VM, and update the inventory after independently confirming the new identity. Never infer guest readiness from `vmrun list` alone.

Production tunnel launcher reads `.local/settings.json` `expectedHostname` and rejects missing or mismatched hostnames. The server also rejects a configured mismatch. Machine-specific settings are intentionally local, not copied between hosts.