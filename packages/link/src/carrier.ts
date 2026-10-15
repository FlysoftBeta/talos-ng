export interface CarrierClose {
  code?: number;
  reason?: string;
}
/** Ordered binary messages; send must either accept the bytes or throw. */
export interface Carrier {
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  onClose(listener: (event: CarrierClose) => void): () => void;
  readonly bufferedAmount?: number;
}
