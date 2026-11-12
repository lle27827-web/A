export type SuccessfulPartitionRead<TNode, TResult> = {
  node: TNode;
  result: TResult;
};

export const PARTITION_READ_QUORUM = 2;

export function hasPartitionReadQuorum(successfulReads: number): boolean {
  return Number.isInteger(successfulReads) && successfulReads >= PARTITION_READ_QUORUM;
}

/**
 * Read enough replicas to tolerate one unavailable store, without querying
 * every configured store on the healthy path.
 */
export async function readWithMinimumReplicaCount<TNode, TResult>(
  nodes: readonly TNode[],
  minimumSuccesses: number,
  read: (node: TNode) => Promise<TResult>,
): Promise<Array<SuccessfulPartitionRead<TNode, Awaited<TResult>>>> {
  if (!Number.isInteger(minimumSuccesses) || minimumSuccesses < 1) {
    throw new RangeError("The minimum successful replica count must be a positive integer.");
  }

  const initialNodes = nodes.slice(0, minimumSuccesses);
  const initialReads = await Promise.all(initialNodes.map(async (node) => {
    try {
      return { node, result: await read(node) };
    } catch {
      return null;
    }
  }));
  const successfulReads = initialReads.filter(
    (entry): entry is SuccessfulPartitionRead<TNode, Awaited<TResult>> => entry !== null,
  );

  for (const node of nodes.slice(initialNodes.length)) {
    if (successfulReads.length >= minimumSuccesses) break;
    try {
      successfulReads.push({ node, result: await read(node) });
    } catch {
      // Continue only until the requested redundancy level is restored.
    }
  }

  return successfulReads;
}
