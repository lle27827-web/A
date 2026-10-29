export function createAsyncMutex() {
  let tail: Promise<void> = Promise.resolve();

  return async function runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  };
}
