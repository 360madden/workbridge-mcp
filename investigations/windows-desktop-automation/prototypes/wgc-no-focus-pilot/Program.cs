using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Windows.SDK.BuildTools.WinApp.UIAutomation;

namespace WgcNoFocusPilot;

internal static class Program
{
    // Only self-test or a window created by this disposable process is accepted.
    // No arbitrary HWND input, no keyboard/mouse injection, no focus-changing API.
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
        {
            try
            {
                SelfTest.Run();
                Console.WriteLine("PASS: synthetic BGRA->PNG assertions");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"FAIL: {ex}");
                return 1;
            }
        }

        if (args.Length == 1 && args[0] == "--capture-disposable")
        {
            // This branch launches a synthetic GUI. Do not execute without the
            // coordinator's *separate* disposable-window-only authorization.
            return CaptureDisposable();
        }

        Console.Error.WriteLine(
            "Usage: WgcNoFocusPilot --self-test | --capture-disposable");
        Console.Error.WriteLine(
            "The capture command is RESERVED for separately authorized disposable-window testing.");
        return 2;
    }

    private static int CaptureDisposable()
    {
        try
        {
            // Always inside this compiled prototype's own output directory:
            // no caller-supplied or guessed path, and CreateNew forbids overwrite.
            string outputPath = Path.Combine(AppContext.BaseDirectory, "pilot.png");
            if (File.Exists(outputPath))
                throw new IOException("Disposable test PNG already exists; refusing to overwrite.");

            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            using var window = new DisposableTestWindow();
            nint foregroundBefore = NativeForeground.GetForegroundWindow();

            // ShowWithoutActivation/WS_EX_NOACTIVATE keep this synthetic window
            // non-activating. The Windows.Forms Show() is not an explicit Win32
            // ShowWindow()/SetForegroundWindow() invocation from this code.
            window.Show();
            window.Refresh();
            Application.DoEvents();
            if (NativeForeground.GetForegroundWindow() != foregroundBefore)
                throw new InvalidOperationException("Synthetic window changed foreground on Show.");

            using var services = new ServiceCollection()
                .AddLogging()
                .AddWinAppUiAutomation()
                .BuildServiceProvider();
            var capture = services.GetRequiredService<IWindowCapture>();
            if (!capture.IsFrameCaptureSupported)
                throw new NotSupportedException("WGC frame capture is unsupported; no fallback.");

            using var frameGrabber = capture.StartFrameGrabber(window.Handle, fps: 1);
            // Pinned Microsoft WinApp.UIAutomation 0.7.1 StartFrameGrabber
            // calls WgcCapture.StartGrabber directly (CreateItemForWindow +
            // D3D11 frame pool); that release has no PrintWindow fallback.
            var foregroundWhileCapturing = NativeForeground.GetForegroundWindow();
            if (foregroundWhileCapturing != foregroundBefore)
                throw new InvalidOperationException("Foreground changed during capture startup.");

            // Keep this method, the Form and its Dispose on the originating
            // STA thread. Pump fixture paint/messages while the free-threaded
            // WGC frame callback completes; never await across an STA boundary.
            using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            Task<bool> firstFrameTask = frameGrabber.WaitForFirstFrameAsync(
                TimeSpan.FromSeconds(7), cancel.Token);
            var deadline = Stopwatch.StartNew();
            while (!firstFrameTask.IsCompleted && deadline.Elapsed < TimeSpan.FromSeconds(8))
            {
                Application.DoEvents();
                if (NativeForeground.GetForegroundWindow() != foregroundBefore)
                    throw new InvalidOperationException("Foreground changed while pumping fixture.");
                Thread.Sleep(20);
            }
            if (!firstFrameTask.IsCompleted)
                throw new TimeoutException("No WGC frame before bounded pump deadline.");
            if (!firstFrameTask.GetAwaiter().GetResult())
                throw new TimeoutException("No WGC frame before timeout.");
            var pixels = frameGrabber.TryGetLatest()
                ?? throw new InvalidOperationException("First WGC frame unavailable.");
            if (pixels.Version < 0)
                throw new InvalidOperationException("Unexpected WGC frame version.");
            SelfTest.ValidateFrame(pixels.Pixels, pixels.Width, pixels.Height, requireColorVariation: true);

            // Double-check the foreground remained untouched.
            if (NativeForeground.GetForegroundWindow() != foregroundBefore)
                throw new InvalidOperationException("Foreground changed during capture.");
            byte[] png = PixelPng.EncodeBgra(pixels.Pixels, pixels.Width, pixels.Height);
            var sha256 = Convert.ToHexString(SHA256.HashData(png));
            // No overwrite; scoped test artifact only.
            using (var output = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write))
                output.Write(png);
            Console.WriteLine(
                $"PASS WGC-only synthetic HWND 0x{window.Handle:X}, {pixels.Width}x{pixels.Height}, " +
                $"frame={pixels.Version}, png-bytes={png.Length}, sha256={sha256}, foreground-unchanged=yes");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"FAIL: {ex}");
            return 1;
        }
    }
}

internal static class NativeForeground
{
    [DllImport("user32.dll", ExactSpelling = true)]
    internal static extern nint GetForegroundWindow(); // Observe only. Never changes focus.
}

internal sealed class DisposableTestWindow : Form
{
    public DisposableTestWindow()
    {
        Text = "WgcNoFocusPilot - synthetic local window";
        Size = new Size(420, 260);
        MinimumSize = Size;
        MaximumSize = Size;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(48, 48);
        ShowInTaskbar = false;
        TopMost = false;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        DoubleBuffered = true;
        BackColor = Color.DarkBlue;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WS_EX_NOACTIVATE = 0x08000000;
            var p = base.CreateParams;
            p.ExStyle |= WS_EX_NOACTIVATE;
            return p;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var navy = new SolidBrush(Color.FromArgb(30, 50, 110));
        using var green = new SolidBrush(Color.FromArgb(20, 180, 90));
        using var orange = new SolidBrush(Color.FromArgb(240, 120, 30));
        e.Graphics.FillRectangle(navy, ClientRectangle);
        e.Graphics.FillRectangle(green, 12, 12, 168, 100);
        e.Graphics.FillRectangle(orange, 196, 18, 160, 120);
    }
}

internal static class PixelPng
{
    public static byte[] EncodeBgra(byte[] bgra, int width, int height)
    {
        SelfTest.ValidateFrame(bgra, width, height, requireColorVariation: false);
        using var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        var bounds = new Rectangle(0, 0, width, height);
        var locked = bmp.LockBits(bounds, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try
        {
            var rowBytes = checked(width * 4);
            for (var y = 0; y < height; y++)
            {
                Marshal.Copy(bgra, y * rowBytes, IntPtr.Add(locked.Scan0, y * locked.Stride), rowBytes);
            }
        }
        finally
        {
            bmp.UnlockBits(locked);
        }
        using var stream = new MemoryStream();
        bmp.Save(stream, ImageFormat.Png);
        return stream.ToArray();
    }
}

internal static class SelfTest
{
    public static void ValidateFrame(
        byte[] bgra, int width, int height, bool requireColorVariation)
    {
        if (width < 1 || height < 1 || width > 16384 || height > 16384)
            throw new ArgumentOutOfRangeException(nameof(width), "Unexpected frame dimensions.");
        int expected = checked(checked(width * height) * 4);
        if (bgra.Length != expected)
            throw new ArgumentException($"BGRA buffer length {bgra.Length} != {expected}.");

        if (requireColorVariation)
        {
            // Detect entirely black/transparent or single-color frames; a
            // known multi-color synthetic fixture must contain variation.
            var first = (bgra[0], bgra[1], bgra[2]);
            var varied = false;
            var anyVisible = false;
            for (int i = 0; i < bgra.Length; i += 4)
            {
                anyVisible |= bgra[i + 3] != 0;
                if ((bgra[i], bgra[i + 1], bgra[i + 2]) != first)
                    varied = true;
            }
            if (!anyVisible || !varied)
                throw new InvalidOperationException("Blank/flat synthetic capture rejected.");
        }
    }

    public static void Run()
    {
        // Top left red, top right green, bottom left blue, bottom right white.
        byte[] bgra =
        [
            0, 0, 255, 255,   0, 255, 0, 255,
            255, 0, 0, 255,   255, 255, 255, 255
        ];
        ValidateFrame(bgra, 2, 2, requireColorVariation: true);
        byte[] png = PixelPng.EncodeBgra(bgra, 2, 2);
        if (png.Length < 24 || png[0] != 0x89 || png[1] != 0x50 || png[2] != 0x4E || png[3] != 0x47)
            throw new InvalidOperationException("PNG signature absent.");
        using var bitmap = new Bitmap(new MemoryStream(png));
        if (bitmap.Width != 2 || bitmap.Height != 2
            || bitmap.GetPixel(0, 0).ToArgb() != Color.Red.ToArgb()
            || bitmap.GetPixel(1, 0).ToArgb() != Color.Lime.ToArgb()
            || bitmap.GetPixel(0, 1).ToArgb() != Color.Blue.ToArgb()
            || bitmap.GetPixel(1, 1).ToArgb() != Color.White.ToArgb())
            throw new InvalidOperationException("BGRA channels/pixel layout swapped.");

        ExpectFailure(() => ValidateFrame(Array.Empty<byte>(), 0, 1, false));
        ExpectFailure(() => ValidateFrame(new byte[4], 2, 2, false));
        ExpectFailure(() => ValidateFrame(new byte[16], 2, 2, true));
        ExpectFailure(() => ValidateFrame(new byte[4], 16385, 1, false));
    }

    private static void ExpectFailure(Action action)
    {
        try { action(); }
        catch (ArgumentException) { return; }
        catch (InvalidOperationException) { return; }
        throw new InvalidOperationException("Invalid input was incorrectly accepted.");
    }
}
