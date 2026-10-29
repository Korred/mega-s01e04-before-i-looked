export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  /** Number of valid events, including retries. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Last error seen, retained when a later event succeeds. */
  lastError: string | null;
  /** Original timestamps from the first and last events in file order. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  /** Sorted by job. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid events, not final job statuses. */
  counts: Record<RunStatus, number>;
};

/** Missing files and invalid YYYY-MM-DD nights return null; other I/O errors reject. */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest | null>;
