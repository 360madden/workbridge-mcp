using System.Collections.Generic;

internal sealed record SessionChangeEvent(int Code, int SessionId, DateTimeOffset AtUtc);

internal sealed class SessionEventLedger
{
    private readonly List<SessionChangeEvent> events = new();
    internal const int MaxEvents = 32;
    internal int ExpectedSessionId { get; }
    internal int TotalEvents { get; private set; }
    internal bool Overflow { get; private set; }
    internal IReadOnlyList<SessionChangeEvent> Events => events;

    internal SessionEventLedger(int expectedSessionId)
    {
        ExpectedSessionId = expectedSessionId;
    }

    // Every WM_WTSSESSION_CHANGE notification invalidates a no-transition
    // receipt, including unexpected reason codes or a mismatched session ID.
    internal void Record(int code, int sessionId, DateTimeOffset atUtc)
    {
        TotalEvents++;
        if (events.Count < MaxEvents)
            events.Add(new SessionChangeEvent(code, sessionId, atUtc));
        else
            Overflow = true;
    }

    internal string Classify(bool registered, bool unregistered, bool pumpActive,
        bool hiddenAndNotForeground, bool samplesHealthy, int sampleCount)
    {
        if (!registered || !unregistered || !pumpActive || !hiddenAndNotForeground ||
            !samplesHealthy || sampleCount < 2 || Overflow)
            return "EVIDENCE_INCOMPLETE";
        return TotalEvents == 0 ? "NO_TRANSITION_OBSERVED" : "TRANSITION_OBSERVED";
    }

    internal static int SelfTest()
    {
        int passed = 0;
        void Check(bool result)
        {
            if (!result) throw new InvalidOperationException("LEDGER_SELF_TEST_FAILED");
            passed++;
        }
        var normal = new SessionEventLedger(1);
        Check(normal.Classify(true, true, true, true, true, 3) == "NO_TRANSITION_OBSERVED");
        Check(normal.Classify(false, true, true, true, true, 3) == "EVIDENCE_INCOMPLETE");
        Check(normal.Classify(true, false, true, true, true, 3) == "EVIDENCE_INCOMPLETE");
        Check(normal.Classify(true, true, false, true, true, 3) == "EVIDENCE_INCOMPLETE");
        Check(normal.Classify(true, true, true, true, true, 1) == "EVIDENCE_INCOMPLETE");
        Check(normal.Classify(true, true, true, true, false, 3) == "EVIDENCE_INCOMPLETE");
        normal.Record(7, 1, DateTimeOffset.UtcNow);
        Check(normal.Classify(true, true, true, true, true, 3) == "TRANSITION_OBSERVED");
        var weird = new SessionEventLedger(1);
        weird.Record(123, 999, DateTimeOffset.UtcNow);
        Check(weird.Classify(true, true, true, true, true, 3) == "TRANSITION_OBSERVED");
        for (int i = 0; i < MaxEvents + 1; i++)
            weird.Record(8, 1, DateTimeOffset.UtcNow);
        Check(weird.Overflow && weird.Events.Count == MaxEvents &&
            weird.Classify(true, true, true, true, true, 3) == "EVIDENCE_INCOMPLETE");
        return passed;
    }
}
