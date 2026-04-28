import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import rpcConfig from '../config/rpc.config';

type RpcMode = 'single' | 'multi';

interface RpcNodeState {
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

@Injectable()
export class RpcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RpcService.name);
  private readonly nodes: RpcNodeState[] = [];
  private readonly allowedMethods = new Set<string>();
  private activeIndex = 0;
  private healthcheckTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(rpcConfig.KEY)
    private readonly config: ConfigType<typeof rpcConfig>,
  ) {}

  onModuleInit() {
    this.config.allowedMethods.forEach((method) => {
      if (method) {
        this.allowedMethods.add(method);
      }
    });

    this.config.urls.forEach((url, index) => {
      this.nodes.push({
        index,
        url,
        requestId: 0,
        healthy: true,
        active: index === 0,
        consecutiveFailures: 0,
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        slowCount: 0,
        ewmaLatencyMs: null,
        lastLatencyMs: null,
        lastError: null,
        lastCheckedAt: null,
        cooldownUntil: 0,
      });
    });

    if (this.mode === 'multi') {
      this.startHealthcheck();
    }
    this.logger.debug(
      `RPC Service initialized in ${this.mode} mode with ${this.nodes.length} provider(s)`,
    );
  }

  onModuleDestroy() {
    if (this.healthcheckTimer) {
      clearInterval(this.healthcheckTimer);
      this.healthcheckTimer = null;
    }
  }

  getProvidersSnapshot() {
    return {
      mode: this.mode,
      active: this.getActiveProviderSnapshot(),
      allowedMethods: [...this.allowedMethods],
      providers: this.nodes.map((node) => ({
        index: node.index,
        endpoint: this.toEndpoint(node.url),
        healthy: node.healthy,
        active: node.active,
        requestCount: node.requestCount,
        successCount: node.successCount,
        failureCount: node.failureCount,
        slowCount: node.slowCount,
        lastLatencyMs: node.lastLatencyMs,
        avgLatencyMs: node.ewmaLatencyMs,
        lastError: node.lastError,
        lastCheckedAt: node.lastCheckedAt,
      })),
    };
  }

  getActiveProviderSnapshot() {
    const node = this.nodes[this.activeIndex];

    return {
      mode: this.mode,
      index: node.index,
      endpoint: this.toEndpoint(node.url),
      healthy: node.healthy,
      avgLatencyMs: node.ewmaLatencyMs,
      lastLatencyMs: node.lastLatencyMs,
      lastError: node.lastError,
    };
  }

  getAllowedMethods() {
    return [...this.allowedMethods];
  }

  reportFailure(url?: string, reason?: string) {
    const target = url
      ? this.nodes.find((node) => node.url === url)
      : this.nodes[this.activeIndex];

    if (!target) {
      return {
        status: 'provider_not_found',
        updated: false,
      };
    }

    this.recordFailure(target, new Error(reason ?? 'external_failure_report'));
    this.maybeSwitchActive('external_failure_report');

    return {
      status: 'failure_recorded',
      updated: true,
      active: this.getActiveProviderSnapshot(),
    };
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.allowedMethods.has(method)) {
      throw new BadRequestException({
        message: `RPC method is not allowed: ${method}`,
        allowedMethods: this.getAllowedMethods(),
      });
    }

    return this.execute(method, (node) =>
      this.sendRpcRequest<T>(node, method, params),
    );
  }

  async getBlockNumber() {
    return this.call<string>('eth_blockNumber');
  }

  private get mode(): RpcMode {
    return this.config.mode === 'multi' ? 'multi' : 'single';
  }

  private startHealthcheck() {
    this.healthcheckTimer = setInterval(() => {
      void this.runHealthcheck();
    }, this.config.healthcheckIntervalMs);

    this.healthcheckTimer.unref();
    void this.runHealthcheck();
  }

  private async runHealthcheck() {
    await Promise.all(
      this.nodes.map(async (node) => {
        const startedAt = Date.now();

        try {
          await this.withTimeout(
            this.sendRpcRequest<string>(node, 'eth_blockNumber', []),
            this.config.timeoutMs,
            `healthcheck timeout for ${this.toEndpoint(node.url)}`,
          );
          this.recordSuccess(node, Date.now() - startedAt, true);
          this.logger.debug(
            `Healthcheck success for ${this.toEndpoint(node.url)} - latency: ${Date.now() - startedAt}ms`,
          );
        } catch (error) {
          this.recordFailure(node, error, true);
          this.logger.debug(
            `Healthcheck failure for ${this.toEndpoint(node.url)} - error: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }),
    );

    this.maybeSwitchActive('healthcheck');
  }

  private async execute<T>(
    operation: string,
    request: (node: RpcNodeState) => Promise<T>,
  ): Promise<T> {
    const candidates = this.getCandidateOrder();
    const errors: string[] = [];

    for (const node of candidates) {
      const startedAt = Date.now();
      node.requestCount += 1;

      try {
        const response = await this.withTimeout(
          request(node),
          this.config.timeoutMs,
          `${operation} timed out for ${this.toEndpoint(node.url)}`,
        );

        this.recordSuccess(node, Date.now() - startedAt);

        if (this.activeIndex !== node.index) {
          this.switchActive(node.index, `successful ${operation}`);
        }

        this.maybeSwitchActive(`post-${operation}`);
        return response;
      } catch (error) {
        this.recordFailure(node, error);
        errors.push(
          `${this.toEndpoint(node.url)}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        this.maybeSwitchActive(`failure in ${operation}`);

        if (this.mode === 'single') {
          break;
        }
      }
    }

    throw new ServiceUnavailableException({
      message: `RPC request failed for operation ${operation}`,
      errors,
      active: this.getActiveProviderSnapshot(),
    });
  }

  private async sendRpcRequest<T>(
    node: RpcNodeState,
    method: string,
    params: unknown[],
  ): Promise<T> {
    const response = await fetch(node.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++node.requestId,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };

    if (payload.error) {
      throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
      throw new Error('Invalid RPC response: missing result field');
    }

    return payload.result as T;
  }

  private getCandidateOrder(): RpcNodeState[] {
    if (this.mode === 'single') {
      return [this.nodes[this.activeIndex]];
    }

    const now = Date.now();
    const available = this.nodes.filter((node) => node.cooldownUntil <= now);
    const pool = available.length > 0 ? available : this.nodes;

    return [...pool].sort(
      (left, right) => this.providerScore(left) - this.providerScore(right),
    );
  }

  private providerScore(node: RpcNodeState): number {
    const latency = node.ewmaLatencyMs ?? 10_000;
    const activeBonus = node.active ? -250 : 0;
    const healthPenalty = node.healthy ? 0 : 5000;
    const failurePenalty = node.consecutiveFailures * 1000;
    const slowPenalty = node.slowCount * 250;

    return latency + activeBonus + healthPenalty + failurePenalty + slowPenalty;
  }

  private maybeSwitchActive(reason: string) {
    if (this.mode === 'single') {
      return;
    }

    const now = Date.now();
    const eligible = this.nodes.filter(
      (node) => node.healthy && node.cooldownUntil <= now,
    );

    if (eligible.length === 0) {
      return;
    }

    const best = eligible.reduce((winner, candidate) =>
      this.providerScore(candidate) < this.providerScore(winner)
        ? candidate
        : winner,
    );

    if (best.index !== this.activeIndex) {
      this.switchActive(best.index, reason);
    }
  }

  private switchActive(index: number, reason: string) {
    this.nodes.forEach((node) => {
      node.active = node.index === index;
    });

    const previous = this.activeIndex;
    this.activeIndex = index;

    if (previous !== index) {
      this.logger.warn(
        `RPC switch: ${this.toEndpoint(this.nodes[previous].url)} -> ${this.toEndpoint(this.nodes[index].url)} (${reason})`,
      );
    }
  }

  private recordSuccess(
    node: RpcNodeState,
    latencyMs: number,
    fromHealthcheck = false,
  ) {
    node.successCount += 1;
    node.consecutiveFailures = 0;
    node.healthy = true;
    node.lastError = null;
    node.lastLatencyMs = latencyMs;
    node.lastCheckedAt = Date.now();
    node.ewmaLatencyMs =
      node.ewmaLatencyMs === null
        ? latencyMs
        : node.ewmaLatencyMs * 0.7 + latencyMs * 0.3;

    if (latencyMs > this.config.slowThresholdMs) {
      node.slowCount += 1;
    } else {
      node.slowCount = Math.max(0, node.slowCount - 1);
    }

    if (!fromHealthcheck) {
      node.cooldownUntil = 0;
    }
  }

  private recordFailure(
    node: RpcNodeState,
    error: unknown,
    fromHealthcheck = false,
  ) {
    node.failureCount += 1;
    node.consecutiveFailures += 1;
    node.lastCheckedAt = Date.now();
    node.lastError = error instanceof Error ? error.message : 'unknown error';

    if (node.consecutiveFailures >= this.config.failureThreshold) {
      node.healthy = false;
      node.cooldownUntil = Date.now() + this.config.recoveryCooldownMs;
    }

    if (
      !fromHealthcheck &&
      node.index === this.activeIndex &&
      this.mode === 'multi'
    ) {
      node.active = false;
    }
  }

  private toEndpoint(url: string): string {
    try {
      const parsed = new URL(url);
      const defaultPort =
        parsed.protocol === 'https:' || parsed.protocol === 'wss:'
          ? '443'
          : '80';
      const port = parsed.port || defaultPort;
      return `${parsed.protocol}//${parsed.hostname}:${port}`;
    } catch {
      return 'invalid_rpc_url';
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
