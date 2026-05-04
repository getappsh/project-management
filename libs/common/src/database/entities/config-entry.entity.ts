import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ConfigGroupEntity } from './config-group.entity';

/**
 * A single key-value pair within a config group.
 *
 * When `isSensitive` is true and Vault integration is enabled, the plaintext
 * value is stored in HashiCorp Vault KV v2 and `value` contains a Vault
 * reference string of the form:
 *   vault:{mountPath}/config-entry-{id}#config_value
 *
 * When Vault is disabled the plaintext is stored directly in `value`.
 *
 * The Vault reference is resolved transparently when the agent fetches its
 * final config via `buildDeviceConfig()`.
 */
@Entity('config_entry')
export class ConfigEntryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ConfigGroupEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: ConfigGroupEntity;

  @Column({ name: 'group_id' })
  groupId: number;

  @Column({ name: 'key' })
  key: string;

  /**
   * Either a plaintext value or a Vault reference (vault:...).
   * Always use ConfigService.resolveEntryValue() when serving to the agent.
   */
  @Column({ name: 'value', type: 'text', nullable: true })
  value: string | null;

  /**
   * When true, the value should be stored in Vault (if enabled) and will be
   * resolved at retrieval time. The field is informational for the UI even
   * when Vault is disabled.
   */
  @Column({ name: 'is_sensitive', type: 'boolean', default: false })
  isSensitive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
