using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace Workbridge.ChatInputProbe;

internal static class Program
{
    internal const string Title = "Workbridge RIFT Chat Input Disposable Probe";
    internal const string Expected = "/reloadui";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1 || !Path.IsPathFullyQualified(args[0]) ||
            args[0].StartsWith(@"\\", StringComparison.Ordinal))
            return 2;
        var destination = Path.GetFullPath(args[0]);
        try
        {
            Directory.CreateDirectory(destination);
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            using var form = new ChatForm(destination);
            Application.Run(form);
            return 0;
        }
        catch (Exception ex)
        {
            try { Log(destination, "error", 0, false, false, ex.GetType().Name); }
            catch { /* preserve original error */ }
            return 1;
        }
    }

    internal static void Log(string dir, string stage, int typedLength, bool opened,
        bool match, string? error = null, long hwnd = 0)
    {
        var data = new
        {
            schemaVersion = 1, stage, utc = DateTimeOffset.UtcNow,
            pid = Environment.ProcessId,
            sessionId = Process.GetCurrentProcess().SessionId,
            hwnd, title = Title, typedLength,
            chatOpen = opened, matchedExpected = match, error,
        };
        File.AppendAllText(Path.Combine(dir, "native-chat-" +
            Environment.ProcessId + ".jsonl"), JsonSerializer.Serialize(data) + Environment.NewLine);
    }

    private sealed class ChatForm : Form
    {
        private readonly string _dir;
        private readonly System.Windows.Forms.Timer _timer;
        private readonly Label _state;
        private bool _chatOpen;
        private string _input = "";
        private int _submitCount;

        internal ChatForm(string dir)
        {
            _dir = dir;
            Text = Title;
            Name = "WorkbridgeChatInputProbe";
            AccessibleName = Title;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(740, 360);
            ShowInTaskbar = true;
            KeyPreview = true;
            BackColor = Color.FromArgb(20, 39, 57);
            ForeColor = Color.White;

            Controls.Add(new Label
            {
                Text = "Disposable RIFT-style custom chat input test",
                Location = new Point(24, 25), AutoSize = true,
                Font = new Font("Segoe UI", 17, FontStyle.Bold)
            });
            _state = new Label
            {
                Text = "Chat closed. Enter to open.",
                Location = new Point(24, 100), AutoSize = true,
                Font = new Font("Segoe UI", 14)
            };
            Controls.Add(_state);
            Controls.Add(new Label
            {
                Text = "This window closes automatically after 100 seconds.",
                Location = new Point(24, 230), AutoSize = true
            });

            KeyDown += OnKeyDown;
            KeyPress += OnKeyPress;
            _timer = new System.Windows.Forms.Timer { Interval = 100_000 };
            _timer.Tick += (_, _) => Close();
            Shown += (_, _) =>
            {
                Log(_dir, "shown", 0, false, false, hwnd: Handle.ToInt64());
                Focus();
                _timer.Start();
            };
            FormClosed += (_, _) =>
            {
                _timer.Stop();
                Log(_dir, "closed", _input.Length, _chatOpen,
                    _input == Expected, hwnd: Handle.ToInt64());
            };
        }

        private void OnKeyDown(object? sender, KeyEventArgs e)
        {
            if (e.KeyCode != Keys.Enter) return;
            if (!_chatOpen)
            {
                _chatOpen = true;
                _input = "";
                _state.Text = "Chat open, awaiting fixed test command...";
                Log(_dir, "opened", 0, true, false, hwnd: Handle.ToInt64());
            }
            else
            {
                _submitCount++;
                bool match = _input == Expected;
                Log(_dir, "submitted", _input.Length, true, match,
                    match ? null : "PAYLOAD_MISMATCH", Handle.ToInt64());
                _chatOpen = false;
                _input = "";
                _state.Text = "Submitted #" + _submitCount + " — exact text? " + match;
            }
            e.SuppressKeyPress = true;
            e.Handled = true;
        }

        private void OnKeyPress(object? sender, KeyPressEventArgs e)
        {
            if (!_chatOpen || char.IsControl(e.KeyChar)) return;
            if (_input.Length < 80) _input += e.KeyChar;
            bool prefixOk = Expected.StartsWith(_input, StringComparison.Ordinal);
            _state.Text = "Typed length: " + _input.Length + "; expected prefix? " + prefixOk;
            Log(_dir, prefixOk ? "typed" : "unexpected", _input.Length, true,
                _input == Expected, prefixOk ? null : "UNEXPECTED_INPUT",
                Handle.ToInt64());
            e.Handled = true;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _timer.Dispose();
            base.Dispose(disposing);
        }
    }
}
