import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { AlertEntity } from '@app/common/database/entities/alert.entity';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(AlertEntity) private readonly alertRepo: Repository<AlertEntity>,
  ) {}

  async handleIncomingAlert(data: Partial<AlertEntity>): Promise<void> {
    try {
      const alert = this.alertRepo.create(data);
      await this.alertRepo.save(alert);
      this.logger.debug(`Alert saved: [${data.severity}] ${data.type} - ${data.message}`);
    } catch (error: any) {
      this.logger.error(`Failed to save alert: ${error.message}`);
    }
  }

  async getAlerts(limit: number, since?: string): Promise<AlertEntity[]> {
    const where: any = {};
    if (since) {
      const hours = this.parseRangeToHours(since);
      where.createdDate = MoreThanOrEqual(new Date(Date.now() - hours * 60 * 60 * 1000));
    }

    return this.alertRepo.find({
      where,
      order: { createdDate: 'DESC' },
      take: limit,
    });
  }

  async getDeviceAlerts(deviceId: string, limit: number): Promise<AlertEntity[]> {
    return this.alertRepo.find({
      where: { deviceId },
      order: { createdDate: 'DESC' },
      take: limit,
    });
  }

  private parseRangeToHours(range: string): number {
    const match = range.match(/^(\d+)(h|d)$/);
    if (!match) return 24;
    const value = parseInt(match[1], 10);
    return match[2] === 'd' ? value * 24 : value;
  }
}
