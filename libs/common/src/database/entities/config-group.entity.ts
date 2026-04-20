import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ConfigRevisionEntity } from './config-revision.entity';
import { ConfigEntryEntity } from './config-entry.entity';

/**
 * A named group of key-value entries within a config revision.
 *
 * A group with `isGlobal = true` is automatically merged into every other group
 * when building the final device configuration (globals group).
 *
 * `gitFilePath` links the group to a YAML file in the associated git repository
 * (GitOps integration). When set, entries are synced from the file contents.
 */
@Entity('config_group')
export class ConfigGroupEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ConfigRevisionEntity, (rev) => rev.groups, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'revision_id' })
  revision: ConfigRevisionEntity;

  @Column({ name: 'revision_id' })
  revisionId: number;

  @Column({ name: 'name' })
  name: string;

  /**
   * When true, this group's entries are automatically merged into every other
   * group of the same revision (and the device's merged config view).
   * Only one globals group per revision is expected, but no DB constraint enforces it.
   */
  @Column({ name: 'is_global', type: 'boolean', default: false })
  isGlobal: boolean;

  /**
   * Optional path to a YAML file inside the linked git repository.
   * When provided the GitOps sync will populate entries from that file's
   * key-value contents instead of managing them manually.
   */
  @Column({ name: 'git_file_path', type: 'varchar', nullable: true })
  gitFilePath: string | null;

  @OneToMany(() => ConfigEntryEntity, (entry: ConfigEntryEntity) => entry.group, { cascade: true })
  entries: ConfigEntryEntity[];
}
