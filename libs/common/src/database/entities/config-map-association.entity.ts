import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { DeviceTypeEntity } from './device-type.entity';

/**
 * Associates a CONFIG_MAP project with one or more device types so that
 * every device belonging to those device types automatically receives the
 * configMap's groups as part of its merged config.
 *
 * `deviceTypeId` is nullable to allow future association strategies (e.g. by OS).
 * When null the association matches all devices (a "global" configMap).
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

  /**
   * When set, the configMap is applied only to devices of this type.
   * Future: additional columns (e.g. `osType`) may narrow the match further.
   */
  @ManyToOne(() => DeviceTypeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'device_type_id' })
  deviceType: DeviceTypeEntity | null;

  @Column({ name: 'device_type_id', nullable: true })
  deviceTypeId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
