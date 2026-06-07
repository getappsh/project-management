import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "./base.entity";

export enum AlertType {
  DISCOVERY_NEW = 'discovery_new',
  DISCOVERY_KNOWN = 'discovery_known',
  DELIVERY_STARTED = 'delivery_started',
  DELIVERY_COMPLETED = 'delivery_completed',
  DELIVERY_ERROR = 'delivery_error',
  DEPLOY_STARTED = 'deploy_started',
  DEPLOY_COMPLETED = 'deploy_completed',
  DEPLOY_ERROR = 'deploy_error',
  PENDING_VERSION = 'pending_version',
  DEVICE_OFFLINE = 'device_offline',
  GIT_SYNC_SUCCESS = 'git_sync_success',
  GIT_SYNC_FAILED = 'git_sync_failed',
  SBOM_READY = 'sbom_ready',
  SBOM_FAILED = 'sbom_failed',
  SYSTEM = 'system',
}

export enum AlertSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
}

@Entity("system_alert")
export class AlertEntity extends BaseEntity {

  @Column({ name: 'type', type: 'varchar', length: 50 })
  @Index()
  type: AlertType;

  @Column({ name: 'severity', type: 'varchar', length: 20 })
  severity: AlertSeverity;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'device_id', type: 'varchar', nullable: true })
  @Index()
  deviceId?: string;

  @Column({ name: 'catalog_id', type: 'varchar', nullable: true })
  catalogId?: string;

  @Column({ name: 'source', type: 'varchar', length: 50, nullable: true })
  source?: string;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
