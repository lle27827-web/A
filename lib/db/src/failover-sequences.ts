export type SequenceSnapshot = {
  sequenceSchema: string;
  sequenceName: string;
  tableSchema: string;
  tableName: string;
  columnName: string;
  startValue: string;
  incrementBy: string;
  minValue: string;
  maxValue: string;
  cycle: boolean;
  lastValue: string | null;
  isCalled: boolean;
  tableMaxValue: string | null;
};

export type SequenceSyncUpdate = {
  sequenceSchema: string;
  sequenceName: string;
  value: string;
  isCalled: boolean;
};

function keyOf(sequence: SequenceSnapshot): string {
  return [
    sequence.sequenceSchema,
    sequence.sequenceName,
    sequence.tableSchema,
    sequence.tableName,
    sequence.columnName,
  ].join("\u0000");
}

function compareBigInts(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Plan sequence updates before promotion. PostgreSQL logical replication copies
 * table rows but not sequence state, so promotion must advance each target
 * sequence beyond both databases' known sequence and table values.
 *
 * Returns null when the sequence layouts/configurations are not compatible or
 * when the application schema uses a sequence shape this synchronizer cannot
 * safely handle.
 */
export function planSequenceSync(
  source: readonly SequenceSnapshot[],
  target: readonly SequenceSnapshot[],
): SequenceSyncUpdate[] | null {
  if (source.length !== target.length) return null;

  const targetByKey = new Map(target.map((sequence) => [keyOf(sequence), sequence]));
  if (targetByKey.size !== target.length) return null;

  const updates: SequenceSyncUpdate[] = [];
  for (const sourceSequence of source) {
    const targetSequence = targetByKey.get(keyOf(sourceSequence));
    if (!targetSequence) return null;

    const compatible =
      sourceSequence.startValue === targetSequence.startValue &&
      sourceSequence.incrementBy === targetSequence.incrementBy &&
      sourceSequence.minValue === targetSequence.minValue &&
      sourceSequence.maxValue === targetSequence.maxValue &&
      sourceSequence.cycle === targetSequence.cycle;
    if (!compatible || sourceSequence.cycle || BigInt(sourceSequence.incrementBy) <= 0n) {
      return null;
    }

    const candidates = [
      sourceSequence.isCalled ? sourceSequence.lastValue : null,
      sourceSequence.tableMaxValue,
      targetSequence.isCalled ? targetSequence.lastValue : null,
      targetSequence.tableMaxValue,
    ].filter((value): value is string => value !== null);

    if (candidates.length === 0) {
      updates.push({
        sequenceSchema: targetSequence.sequenceSchema,
        sequenceName: targetSequence.sequenceName,
        value: targetSequence.startValue,
        isCalled: false,
      });
      continue;
    }

    let value = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (compareBigInts(candidate, value) > 0) value = candidate;
    }

    if (
      compareBigInts(value, targetSequence.minValue) < 0 ||
      compareBigInts(value, targetSequence.maxValue) > 0
    ) {
      return null;
    }

    updates.push({
      sequenceSchema: targetSequence.sequenceSchema,
      sequenceName: targetSequence.sequenceName,
      value,
      isCalled: true,
    });
  }

  return updates;
}
