import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Index } from 'typeorm';
import { ProjectEntity } from './project.entity';

@Entity('deployment_report_cache')
@Index('idx_deployment_report_cache_project_date', ['project', 'cachedAt'])
export class DeploymentReportCacheEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ProjectEntity, { nullable: false })
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity;

  @Column({ name: 'report_data', type: 'jsonb' })
  reportData: any;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'cached_at', type: 'timestamptz' })
  cachedAt: Date;
}
