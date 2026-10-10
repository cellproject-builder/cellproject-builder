/** Implementations must encrypt values and bind their storage to the unlocked owner/vault. */
export interface CheckpointStore {
  read<T>(slot: string): Promise<T | null>;
  write(slot: string, value: unknown): Promise<void>;
  remove(slot: string): Promise<void>;
}
