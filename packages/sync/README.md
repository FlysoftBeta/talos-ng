# @talos/sync

Pure synchronisation algorithms: LWW/Max/immutable registers, `IntervalSet`, pull planning
(`planApply`, `mergePage`, `selectDelta`), outbox reducer and optimistic pending marks. Design
and invariants: `docs/impl/sync.md`; the contract of each function is in its source and tests.
