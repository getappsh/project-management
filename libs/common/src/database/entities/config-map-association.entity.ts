import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { DeviceTypeEntity } from './device-type.entity';

/**
 * Associates a CONFIG_MAP project with one or more device types so that
 * every device belonging to those device types automatically receives the
 * configMap's groups as part of its merged config.
 *
 * Each row can represent:
 *  - device-type rule:  deviceTypeId set, configProjectId null  → applies to all devices of that type
 *  - direct link:       configProjectId set, deviceTypeId null  → applies to this specific CONFIG project
 *  - global:            both null                                → applies to all CONFIG projects
 */
@Entity('config_map_association')
export class ConfigMapAssociationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProjectEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'config_map_project_id' })
  configMapProject: ProjectEntity;

  @Column({ name: 'config_map_project_id' })
  configMapProjectId: number;

  @ManyToOne(() => DeviceTypeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'device_type_id' })
  deviceType: DeviceTypeEntity | null;

  @Column({ name: 'device_type_id', nullable: true })
  deviceTypeId: number | null;

  /**
   * When set this row is a direct link between this CONFIG_MAP project and a specific
   * CONFIG project. Auto-populated when a device-type association is created (for
   * existing devices of that type) or when a new device CONFIG project is created.
   */
  @ManyToOne(() => ProjectEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'config_project_id' })
  configProject: ProjectEntity | null;

  @Column({ name: 'config_project_id', nullable: true })
  configProjectId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
