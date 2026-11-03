using Workbridge.ControlCenter;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

var assertions = 0;
void Check(bool value, string label)
{
    if (!value) throw new InvalidOperationException("FAILED: " + label);
    assertions++;
}

async Task ShouldReject(string content, int maxLength, string label)
{
    var reader = new BoundedLineReader(new StringReader(content), maxLength);
    var rejected = false;
    try { _ = await reader.ReadLineAsync(CancellationToken.None); }
    catch (InvalidDataException) { rejected = true; }
    Check(rejected, label);
}

{
    var reader = new BoundedLineReader(new StringReader(""), 64);
    Check(await reader.ReadLineAsync(CancellationToken.None) is null, "empty EOF");
}
{
    var reader = new BoundedLineReader(new StringReader("alpha\nbeta\r\ngamma"), 64);
    Check(await reader.ReadLineAsync(CancellationToken.None) == "alpha", "first line");
    Check(await reader.ReadLineAsync(CancellationToken.None) == "beta", "CRLF line");
    Check(await reader.ReadLineAsync(CancellationToken.None) == "gamma", "unterminated last line");
    Check(await reader.ReadLineAsync(CancellationToken.None) is null, "EOF after last line");
}
{
    var reader = new BoundedLineReader(new StringReader("\n"), 64);
    Check(await reader.ReadLineAsync(CancellationToken.None) == "", "blank line");
    Check(await reader.ReadLineAsync(CancellationToken.None) is null, "EOF after blank line");
}
{
    var reader = new BoundedLineReader(new StringReader(new string('a', 64) + "\n"), 64);
    Check((await reader.ReadLineAsync(CancellationToken.None))?.Length == 64, "exact boundary");
}
await ShouldReject(new string('b', 65) + "\n", 64, "one char over boundary");
await ShouldReject(new string('b', 65), 64, "unterminated over boundary");
{
    var reader = new BoundedLineReader(new StringReader(new string('x', 4095) + "\r\nNEXT"), 4096);
    Check(await reader.ReadLineAsync(CancellationToken.None) == new string('x', 4095), "split CRLF boundary");
    Check(await reader.ReadLineAsync(CancellationToken.None) == "NEXT", "preserve buffered next line");
}
{
    var source = new RepeatReader(2_000_000);
    var reader = new BoundedLineReader(source, 64_000);
    var rejected = false;
    try { _ = await reader.ReadLineAsync(CancellationToken.None); }
    catch (InvalidDataException) { rejected = true; }
    Check(rejected, "large unbounded stream rejected");
    Check(source.ReadCount <= 64_000 + 4096, "read terminated near bound");
}
{
    var cancelled = new CancellationTokenSource();
    cancelled.Cancel();
    var reader = new BoundedLineReader(new StringReader("hello"), 64);
    var rejected = false;
    try { _ = await reader.ReadLineAsync(cancelled.Token); }
    catch (OperationCanceledException) { rejected = true; }
    Check(rejected, "cancellation honored");
}
Console.WriteLine($"PASS: {assertions} bounded-line assertions");

internal sealed class RepeatReader(int count) : TextReader
{
    private int _remaining = count;
    public int ReadCount { get; private set; }

    public override ValueTask<int> ReadAsync(Memory<char> buffer, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var take = Math.Min(buffer.Length, _remaining);
        buffer.Span[..take].Fill('z');
        _remaining -= take;
        ReadCount += take;
        return ValueTask.FromResult(take);
    }
}
