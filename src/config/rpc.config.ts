import { registerAs } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface RpcConfigFile {
  mode?: 'single' | 'multi';
  urls?: string[];
  allowedMethods?: string[];
  timeoutMs?: number;
  healthcheckIntervalMs?: number;
  slowThresholdMs?: number;
  failureThreshold?: number;
  recoveryCooldownMs?: number;
}

function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadRpcConfigFile(): RpcConfigFile {
  try {
    const raw = readFileSync(join(process.cwd(), 'rpcconfig.json'), 'utf-8');
    const parsed = JSON.parse(raw) as RpcConfigFile;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export default registerAs('rpc', () => {
  const fileConfig = loadRpcConfigFile();
  const urls = fileConfig.urls?.length
    ? fileConfig.urls
    : ['https://ethereum-rpc.publicnode.com'];
  const mode =
    fileConfig.mode?.trim().toLowerCase() ||
    (urls.length > 1 ? 'multi' : 'single');
  const allowedMethods = fileConfig.allowedMethods?.length
    ? fileConfig.allowedMethods
    : ['eth_blockNumber'];
  const timeoutMs = asNumber(
    process.env.RPC_TIMEOUT_MS,
    fileConfig.timeoutMs ?? 5000,
  );
  const healthcheckIntervalMs = asNumber(
    process.env.RPC_HEALTHCHECK_INTERVAL_MS,
    fileConfig.healthcheckIntervalMs ?? 15000,
  );
  const slowThresholdMs = asNumber(
    process.env.RPC_SLOW_THRESHOLD_MS,
    fileConfig.slowThresholdMs ?? 1200,
  );
  const failureThreshold = asNumber(
    process.env.RPC_FAILURE_THRESHOLD,
    fileConfig.failureThreshold ?? 3,
  );
  const recoveryCooldownMs = asNumber(
    process.env.RPC_RECOVERY_COOLDOWN_MS,
    fileConfig.recoveryCooldownMs ?? 30000,
  );

  return {
    mode,
    urls,
    allowedMethods,
    timeoutMs,
    healthcheckIntervalMs,
    slowThresholdMs,
    failureThreshold,
    recoveryCooldownMs,
  };
});
