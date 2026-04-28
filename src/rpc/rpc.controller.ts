import { Body, Controller, Get, Post } from '@nestjs/common';
import { RpcService } from './rpc.service';

@Controller('rpc')
export class RpcController {
  constructor(private readonly rpcService: RpcService) {}

  @Get('providers')
  providers() {
    return this.rpcService.getProvidersSnapshot();
  }

  @Get('active')
  active() {
    return this.rpcService.getActiveProviderSnapshot();
  }

  @Get('allowed-methods')
  allowedMethods() {
    return {
      methods: this.rpcService.getAllowedMethods(),
    };
  }

  @Post('call')
  async call(@Body() body: { method: string; params?: unknown[] }) {
    return {
      method: body.method,
      result: await this.rpcService.call(body.method, body.params ?? []),
    };
  }

  @Post('report-failure')
  reportFailure(@Body() body?: { url?: string; reason?: string }) {
    return this.rpcService.reportFailure(body?.url, body?.reason);
  }
}
