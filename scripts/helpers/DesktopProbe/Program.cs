using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace Workbridge.DesktopProbe;

internal static class Program
{
    private const string WindowTitle = "Workbridge GUI-004 Native Input Probe";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1 || !Path.IsPathFullyQualified(args[0]) ||
            args[0].StartsWith(@"\\", StringComparison.Ordinal))
        {
            return 2;
        }
        var outputDir = Path.GetFullPath(args[0]);
        try
        {
            Directory.CreateDirectory(outputDir);
            Log(outputDir, "starting", 0, 0, null);
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            using var form = new ProbeForm(outputDir);
            Application.Run(form);
            Log(outputDir, "closed", form.Counter, form.ObservedWindowHandle, null);
            return 0;
        }
        catch (Exception error)
        {
            try { Log(outputDir, "error", 0, 0, error.GetType().Name); }
            catch { /* A probe must not retry unknown filesystem mutations. */ }
            return 1;
        }
    }

    internal static void Log(string outputDir, string stage, int counter, long hwnd, string? error)
    {
        var receipt = new
        {
            schemaVersion = 1,
            stage,
            utc = DateTimeOffset.UtcNow,
            pid = Environment.ProcessId,
            sessionId = Process.GetCurrentProcess().SessionId,
            hwnd,
            counter,
            title = WindowTitle,
            error,
        };
        var file = Path.Combine(outputDir, $"native-probe-{Environment.ProcessId}.jsonl");
        File.AppendAllText(file, JsonSerializer.Serialize(receipt) + Environment.NewLine);
    }

    private sealed class ProbeForm : Form
    {
        private readonly string _outputDir;
        private readonly Label _counterLabel;
        private readonly System.Windows.Forms.Timer _timer;
        private int _counter;

        internal int Counter => _counter;
        internal long ObservedWindowHandle { get; private set; }

        internal ProbeForm(string outputDir)
        {
            _outputDir = outputDir;
            Text = WindowTitle;
            Name = "WorkbridgeDesktopProbe";
            AccessibleName = WindowTitle;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(700, 410);
            BackColor = Color.FromArgb(23, 33, 56);
            ForeColor = Color.White;
            ShowInTaskbar = true;

            var heading = new Label
            {
                Text = "Workbridge — controlled UI test",
                Location = new Point(35, 35),
                AutoSize = true,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 19, FontStyle.Bold),
            };
            Controls.Add(heading);

            _counterLabel = new Label
            {
                Name = "CounterDisplay",
                AccessibleName = "Probe Counter",
                Text = "Count: 0",
                Location = new Point(38, 120),
                AutoSize = true,
                ForeColor = Color.LightGreen,
                Font = new Font("Segoe UI", 20),
            };
            Controls.Add(_counterLabel);

            var increment = new Button
            {
                Name = "IncrementButton",
                AccessibleName = "Increment Probe Counter",
                Text = "Increment",
                Location = new Point(38, 200),
                Size = new Size(170, 58),
            };
            increment.Click += (_, _) =>
            {
                _counter++;
                _counterLabel.Text = $"Count: {_counter}";
                Log(_outputDir, "incremented", _counter, Handle.ToInt64(), null);
            };
            Controls.Add(increment);

            var reset = new Button
            {
                Name = "ResetButton",
                AccessibleName = "Reset Probe Counter",
                Text = "Reset",
                Location = new Point(230, 200),
                Size = new Size(140, 58),
            };
            reset.Click += (_, _) =>
            {
                _counter = 0;
                _counterLabel.Text = "Count: 0";
                Log(_outputDir, "reset", _counter, Handle.ToInt64(), null);
            };
            Controls.Add(reset);

            Controls.Add(new Label
            {
                Text = "Disposable input test. Closes automatically after 120 seconds.",
                Location = new Point(40, 310),
                AutoSize = true,
                ForeColor = Color.LightSteelBlue,
            });

            _timer = new System.Windows.Forms.Timer { Interval = 120_000 };
            _timer.Tick += (_, _) => Close();
            Shown += (_, _) =>
            {
                ObservedWindowHandle = Handle.ToInt64();
                Log(_outputDir, "shown", _counter, ObservedWindowHandle, null);
                _timer.Start();
            };
            FormClosed += (_, _) => _timer.Stop();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _timer.Dispose();
            base.Dispose(disposing);
        }
    }
}
