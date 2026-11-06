// Pure synthetic contract tests. No Win32, FlaUI calls, focus, mouse or game input.
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RiftRetrySender;

internal static class SyntheticTests
{
    private static byte[] PngBytes()
    {
        byte[] image = new byte[33];
        new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }.CopyTo(image, 0);
        BinaryPrimitives.WriteInt32BigEndian(image.AsSpan(8, 4), 13);
        "IHDR"u8.CopyTo(image.AsSpan(12, 4));
        BinaryPrimitives.WriteInt32BigEndian(image.AsSpan(16, 4), 1920);
        BinaryPrimitives.WriteInt32BigEndian(image.AsSpan(20, 4), 1032);
        return image;
    }

    private static JsonNode Fixture(DateTimeOffset now, byte[] png)
    {
        string started = now.AddMinutes(-10).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        string captured = now.AddSeconds(-5).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        string current = now.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        string sha = Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant();
        var target = new { pid = 32156, hwnd = 462734, startedUtc = started, sessionId = 1 };
        var outer = new { x = -1928, y = -2, width = 1936, height = 1048 };
        var dwm = new { x = -1920, y = 6, width = 1920, height = 1032 };
        var window = new
        {
            target.pid, target.hwnd, process = "rift_x64", className = "TWNClientFramework",
            title = "RIFT", ownerHwnd = 0, outer.x, outer.y, outer.width, outer.height,
            isVisible = true, isForeground = true
        };
        var fixture = new
        {
            target,
            processBefore = new { target.pid, target.startedUtc, target.sessionId },
            processAfter = new { target.pid, target.startedUtc, target.sessionId },
            windowBefore = window,
            windowAfter = window,
            uiaRootAfter = new
            {
                target.hwnd, className = "TWNClientFramework", isEnabled = true,
                isOffscreen = false, outer.x, outer.y, outer.width, outer.height
            },
            desktop = new
            {
                coordinateSpace = "physical-virtual-screen-pixels",
                pointerPositionVerified = true, windowFramePixelsVerified = true
            },
            dpiAwareness = "per-monitor-v2",
            coordinateMapping = new
            {
                mode = "dwm-extended-frame-physical",
                source = "win32-DwmGetWindowAttribute-DWMWA_EXTENDED_FRAME_BOUNDS",
                dwmFrame = dwm,
                outerWindow = outer,
                clientOrigin = new { x = -1920, y = 29 },
                clientSize = new { width = 1920, height = 1009 },
                observedUtc = current,
                dpi = 96, dpiAwareness = "per-monitor-v2"
            },
            capture = new
            {
                target.pid, target.hwnd, process = "rift_x64",
                expectedClass = "TWNClientFramework", title = "RIFT",
                imageBytesVerified = true, imageSha256Verified = true,
                imageDimensionsVerified = true, inputInjected = false,
                requestId = "rift_retry_20261105_capture", sha256 = sha,
                capturedUtc = captured, width = 1920, height = 1032
            },
            visual = new
            {
                captureRequestId = "rift_retry_20261105_capture",
                captureSha256 = sha,
                attestation = "rrecollector-0.4.11-retry-button-visible",
                rect = new { left = 1510, top = 430, right = 1575, bottom = 458 }
            },
            nowUtc = current,
            plan = new
            {
                kind = "physical-rift-retry-DWM-OFFLINE-PLAN",
                executable = false, liveAuthorized = false, target,
                captureRequestId = "rift_retry_20261105_capture", captureSha256 = sha,
                sourceDwmRect = dwm,
                virtualScreenPoint = new { x = -378, y = 450 },
                proposedTransport = "FlaUI.Core.Input.Mouse.Click(Point)",
                requiredNextGate = "P3 independent review and target-specific Joey approval"
            }
        };
        // ROI midpoint: floor((1510+1575)/2)=1542 => virtual -378;
        // floor((430+458)/2)=444 => virtual 6+444=450.
        return JsonNode.Parse(JsonSerializer.Serialize(fixture))!;
    }

    private static ValidatedIntent Validate(JsonNode value, byte[] png, DateTimeOffset now)
    {
        using JsonDocument doc = JsonDocument.Parse(value.ToJsonString());
        return Witness.Validate(doc.RootElement, png, now);
    }

    private static NativeWitness NativeFixture(ValidatedIntent v) =>
        new(v.Pid, v.Hwnd, v.StartedUtc, v.SessionId,
            "rift_x64", "RIFT", "TWNClientFramework", 0, true,
            v.Hwnd, v.Hwnd, v.OuterWindow, v.DwmFrame, v.ClientScreen,
            new PixelRect(-3840, -100, 5760, 2160), 96, true);

    internal static int Run()
    {
        byte[] png = PngBytes();
        DateTimeOffset now = DateTimeOffset.UtcNow;
        int pass = 0, fail = 0;
        void Check(string name, Action action)
        {
            try { action(); pass++; }
            catch (Exception e)
            {
                fail++;
                Console.Error.WriteLine($"FAIL {name}: {e.GetType().Name} {e.Message}");
            }
        }
        void Rejected(string name, string code, Action<JsonNode> mutation)
        {
            Check(name, () =>
            {
                JsonNode node = Fixture(now, png);
                mutation(node);
                try { _ = Validate(node, png, now); }
                catch (GuardFailure error) when (error.Code == code) { return; }
                throw new Exception("Did not fail with expected code " + code);
            });
        }

        Check("valid DWM plan and negative virtual-screen X", () =>
        {
            ValidatedIntent v = Validate(Fixture(now, png), png, now);
            if (v.ClickPoint != new PixelPoint(-378, 450) ||
                v.DwmFrame != new PixelRect(-1920, 6, 1920, 1032))
                throw new Exception("Wrong DWM offset or negative coordinate");
            NativeProbe.RequireExact(NativeFixture(v), v); // pure object assertion
        });
        Rejected("reject old outer-window planner", "INVALID_PLAN",
            x => x["plan"]!["kind"] = "physical-rift-retry-OFFLINE-PLAN");
        Rejected("reject missing persisted Node plan", "MISSING_FIELD",
            x => x.AsObject().Remove("plan"));
        Rejected("reject missing persisted nowUtc", "MISSING_FIELD",
            x => x.AsObject().Remove("nowUtc"));
        Rejected("reject missing capture verified flag", "MISSING_FIELD",
            x => x["capture"]!.AsObject().Remove("imageBytesVerified"));
        Rejected("reject missing screenshot frame pixel proof", "MISSING_FIELD",
            x => x["desktop"]!.AsObject().Remove("windowFramePixelsVerified"));
        Rejected("reject arbitrary click coordinate", "PLAN_POINT_MISMATCH",
            x => x["plan"]!["virtualScreenPoint"]!["x"] = -377);
        Rejected("reject swapped PID", "PID_CHANGED",
            x => x["processAfter"]!["pid"] = 9999);
        Rejected("reject changed session", "SESSION_CHANGED",
            x => x["processBefore"]!["sessionId"] = 2);
        Rejected("reject changed start", "PROCESS_START_CHANGED",
            x => x["processAfter"]!["startedUtc"] = now.AddMinutes(-9).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
        Rejected("reject class spoof", "WINDOW_CLASS_TITLE_CHANGED",
            x => x["windowAfter"]!["className"] = "OtherWindow");
        Rejected("reject background Rift", "WINDOW_NOT_FOREGROUND",
            x => x["windowAfter"]!["isForeground"] = false);
        Rejected("reject invalid DPI claim", "DPI_COORDINATE_UNVERIFIED",
            x => x["dpiAwareness"] = "system");
        Rejected("reject old outer mapping", "DWM_MAPPING_REQUIRED",
            x => x["coordinateMapping"]!["mode"] = "outer-window-physical");
        Rejected("reject unsupported DWM source", "DWM_MAPPING_REQUIRED",
            x => x["coordinateMapping"]!["source"] = "unverified-window-origin");
        Rejected("reject stale DWM observation", "DWM_GEOMETRY_STALE",
            x => x["coordinateMapping"]!["observedUtc"] = now.AddMinutes(-1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
        Rejected("reject outer/dwm confusion", "CAPTURE_DWM_DIMENSIONS_MISMATCH",
            x => x["capture"]!["width"] = 1936);
        Rejected("reject screenshot SHA drift", "SCREENSHOT_HASH_MISMATCH",
            x => x["capture"]!["sha256"] = new string('a', 64));
        Rejected("reject stale capture", "CAPTURE_STALE",
            x => x["capture"]!["capturedUtc"] = now.AddSeconds(-60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
        Rejected("reject visual mismatched image", "VISUAL_ATTESTATION_REQUIRED",
            x => x["visual"]!["captureRequestId"] = "another_capture_id");
        Rejected("reject oversized ROI", "UNSAFE_RETRY_ROI",
            x => x["visual"]!["rect"]!["right"] = 1700);
        Rejected("reject edge ROI", "UNSAFE_RETRY_ROI",
            x => x["visual"]!["rect"]!["top"] = 4);
        Rejected("reject false live authorization", "INVALID_PLAN",
            x => x["plan"]!["liveAuthorized"] = true);
        Rejected("reject visual false action", "VISUAL_ATTESTATION_REQUIRED",
            x => x["visual"]!["attestation"] = "some-other-button");

        void NativeReject(string name, string code, Func<NativeWitness, NativeWitness> mutate)
        {
            Check(name, () =>
            {
                ValidatedIntent v = Validate(Fixture(now, png), png, now);
                try { NativeProbe.RequireExact(mutate(NativeFixture(v)), v); }
                catch (GuardFailure error) when (error.Code == code) { return; }
                throw new Exception("Native object did not reject " + code);
            });
        }
        NativeReject("native wrong HWND foreground", "NATIVE_POINT_OCCLUDED",
            n => n with { ForegroundHwnd = n.Hwnd + 1 });
        NativeReject("native wrong WindowFromPoint root", "NATIVE_POINT_OCCLUDED",
            n => n with { WindowFromPointRoot = n.Hwnd + 1 });
        NativeReject("native DWM shifted by eight pixels", "NATIVE_DPI_FRAME_CHANGED",
            n => n with { DwmFrame = n.DwmFrame with { X = n.DwmFrame.X - 8 } });
        NativeReject("native client origin changed", "NATIVE_DPI_FRAME_CHANGED",
            n => n with { ClientScreen = n.ClientScreen with { Y = n.ClientScreen.Y + 23 } });
        NativeReject("native no PMv2 awareness", "NATIVE_DPI_FRAME_CHANGED",
            n => n with { ThreadPerMonitorV2 = false });
        NativeReject("native wrong Windows session", "NATIVE_PROCESS_IDENTITY_CHANGED",
            n => n with { SessionId = 999 });
        NativeReject("native coordinate outside virtual screens", "NATIVE_CLICK_OUTSIDE",
            n => n with { VirtualScreen = new PixelRect(0, 0, 1920, 1080) });

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            status = fail == 0 ? "SELF_TEST_PASS" : "SELF_TEST_FAIL",
            passed = pass, failed = fail, inputInjected = false,
            liveInputAllowed = false
        }));
        return fail == 0 ? 0 : 1;
    }
}
