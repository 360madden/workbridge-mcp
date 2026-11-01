using System.Security.Principal;

// Fixed diagnostic: no commands, paths, request files, network, or system writes.
// The unelevated launcher records our exit code; this process writes no receipt.
if (args.Length != 0) return 2;
using var identity = WindowsIdentity.GetCurrent();
return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) ? 0 : 5;
