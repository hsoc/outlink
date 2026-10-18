/** Mobile BLE duplex transport for Bitchat discovery and raw protocol frames.
 * Check availability before starting; mode/frame-size/compression support is
 * required by the session. Listener registration and availability are synchronous.
 */

/** Handle returned by `addListener`; call `remove()` to unsubscribe. */
export type ProximityTransportSubscription = { remove(): void };

export interface ProximityTransportPort {
  /** Select Bitchat mode before starting the native transport. */
  configureProtocolAsync?(protocol: 'bitchat'): Promise<void>;
  /** Negotiated GATT value size, excluding ATT overhead. */
  maximumFrameSizeAsync?(endpointId: string): Promise<number>;
  /** Bounded raw DEFLATE used by Bitchat peers; exact output size is required. */
  inflateRawAsync?(bytes: Uint8Array, size: number): Promise<Uint8Array>;
  /** Whether the native transport capability is present at all. */
  isAvailable(): boolean;
  /**
   * Request the OS permissions the transport needs. On Android this asks for
   * the runtime Bluetooth permissions (scan/connect/advertise on API 31+,
   * fine location below); other platforms need nothing and resolve granted.
   */
  requestPermissions(): Promise<boolean>;
  /** Start advertising the given binary peer profile. */
  startAdvertisingAsync(profile: Uint8Array): Promise<void>;
  /** Tear down one endpoint without suppressing its future rediscovery. */
  disconnectAsync?(endpointId: string): Promise<void>;
  /** Scan for nearby peers for `scanDurationMs`. */
  startScanAsync(scanDurationMs: number): Promise<void>;
  /** Stop an active scan. */
  stopScanAsync(): Promise<void>;
  /** Tear down the whole transport session (advertising, scanning, links). */
  stopSessionAsync(): Promise<void>;
  /** Send one complete binary protocol packet to a connected endpoint. */
  sendAsync(endpointId: string, payload: Uint8Array): Promise<void>;
  /**
   * Subscribe to a transport event (e.g. `onPeer`, `onMessage`). Connection,
   * peer, and message events carry the native connection `generation` so a
   * stable platform endpoint ID cannot mix successive physical links. Returns
   * a subscription whose `remove()` unsubscribes.
   */
  addListener(
    name: string,
    listener: (event: Record<string, unknown>) => void,
  ): ProximityTransportSubscription;
}
