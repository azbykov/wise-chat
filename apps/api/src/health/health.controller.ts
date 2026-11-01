import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Public } from '../auth/public.decorator';

export interface HealthResponse {
  status: 'ok';
  mongo: 'up';
}

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Liveness for Docker: the process answers and MongoDB responds to a ping. */
  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.connection.db!.admin().ping();
    } catch {
      throw new ServiceUnavailableException('MongoDB is unavailable');
    }
    return { status: 'ok', mongo: 'up' };
  }
}
