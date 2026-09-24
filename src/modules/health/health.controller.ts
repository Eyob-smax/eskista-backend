import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly indicator: HealthIndicatorService,
    private readonly jobs: JobsService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness and dependency check',
    description:
      'Checks Postgres and the job queue. The queue counts are included because a ' +
      'worker that has stopped draining is invisible otherwise — the API keeps serving ' +
      'while scheduled reminders quietly pile up unsent.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        info: {
          postgres: { status: 'up' },
          queue: { status: 'up', waiting: 0, delayed: 3, failed: 0 },
        },
      },
    },
  })
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('postgres', this.prisma),
      () => this.checkQueue(),
    ]);
  }

  /**
   * Reports queue depth.
   *
   * Reachability is the health signal; a backlog is not. Reporting "down" because jobs are
   * waiting would make a busy queue look like an outage and, worse, could take a healthy
   * instance out of a load balancer.
   */
  private async checkQueue() {
    const check = this.indicator.check('queue');
    try {
      const counts = await this.jobs.health();
      return check.up(counts);
    } catch (error) {
      return check.down({ message: error instanceof Error ? error.message : String(error) });
    }
  }
}
