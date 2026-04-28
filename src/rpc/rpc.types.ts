export type RpcMode = 'single' | 'multi';

export interface RpcNodeState {
  index: number;
  url: string;
  requestId: number;
  healthy: boolean;
  active: boolean;
  consecutiveFailures: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  slowCount: number;
  ewmaLatencyMs: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastCheckedAt: number | null;
  cooldownUntil: number;
}
