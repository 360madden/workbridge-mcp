using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Workbridge.ControlCenter;

/// <summary>
/// Reads newline-delimited messages without buffering an unbounded line.
/// A single fixed-size buffer is reused across reads, including when a read
/// contains part of the next line.
/// </summary>
internal sealed class BoundedLineReader
{
    private const int BufferSize = 4096;
    private readonly TextReader _source;
    private readonly int _maxLength;
    private readonly char[] _buffer = new char[BufferSize];
    private int _offset;
    private int _count;

    public BoundedLineReader(TextReader source, int maxLength)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
        if (maxLength <= 0) throw new ArgumentOutOfRangeException(nameof(maxLength));
        _maxLength = maxLength;
    }

    public async Task<string?> ReadLineAsync(CancellationToken cancellationToken)
    {
        var result = new StringBuilder();
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_offset == _count)
            {
                _count = await _source.ReadAsync(_buffer.AsMemory(), cancellationToken);
                _offset = 0;
                if (_count == 0) return result.Length == 0 ? null : result.ToString();
            }

            var remaining = _buffer.AsSpan(_offset, _count - _offset);
            var newline = remaining.IndexOf('\n');
            var length = newline >= 0 ? newline : remaining.Length;
            if (length > _maxLength - result.Length)
                throw new InvalidDataException($"Monitor message exceeded {_maxLength} characters.");

            result.Append(_buffer, _offset, length);
            _offset += length;
            if (newline >= 0)
            {
                _offset++; // Consume newline; preserve bytes after it for the next call.
                if (result.Length > 0 && result[result.Length - 1] == '\r')
                    result.Length--;
                return result.ToString();
            }
        }
    }
}
