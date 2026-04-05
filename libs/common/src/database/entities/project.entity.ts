import { Column, Entity, Index, JoinTable, ManyToMany, OneToMany, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { MemberProjectEntity } from "./member_project.entity";
import { RegulationEntity } from "./regulation.entity";
import { ReleaseEntity } from "./release.entity";
import { ProjectTokenEntity } from "./project-token.entity";
import { DocEntity } from "./document.entity";
import { ProjectType } from "./enums.entity";
import { DeviceTypeEntity } from "./device-type.entity";
import { PlatformEntity } from "./platform.entity";
import { LabelEntity } from "./label.entity";

@Entity("project")
export class ProjectEntity extends BaseEntity {

    @Index("project_name_unique_constraint", { unique: true })
    @Column({ name: "name" })
    name: string;

    @Column({ name: "project_name", nullable: true })
    projectName?: string;

    // needs to be nullable
    @Column({ name: "description", nullable: true })
    description?: string;

    @OneToMany(() => ProjectTokenEntity, (token) => token.project)
    tokens: ProjectTokenEntity[];


    @ManyToMany(() => PlatformEntity, { eager: true })
    @JoinTable({
        name: "project_platforms",
        joinColumn: { name: "project_id", referencedColumnName: "id" },
        inverseJoinColumn: { name: "platform_name", referencedColumnName: "name" },
    })
    platforms: PlatformEntity[];

    @OneToMany(() => RegulationEntity, regulation => regulation.project)
    regulations: RegulationEntity[]

    @OneToMany(() => MemberProjectEntity, memberProject => memberProject.project)
    memberProject: MemberProjectEntity[];

    @OneToMany(() => ReleaseEntity, release => release.project)
    releases: ReleaseEntity[];

    @Column({ type: "jsonb", nullable: true, name: "project_summary", default: {} })
    projectSummary: Record<string, any>;


    @OneToMany(() => DocEntity, (doc) => doc.project, { lazy: true })
    docs: Promise<DocEntity[]>;

    @Column({ name: "project_type", type: "enum", enum: ProjectType, default: ProjectType.APPLICATION })
    projectType: ProjectType;

    @ManyToMany(() => DeviceTypeEntity, deviceType => deviceType.projects)
    deviceTypes: DeviceTypeEntity[];

    @ManyToOne(() => LabelEntity, label => label.projects, { nullable: true })
    @JoinColumn({ name: "label_id" })
    label: LabelEntity | null;

    @Column({ name: "git_clone_url", nullable: true, type: 'varchar' })
    gitCloneUrl?: string | null;

    @Column({ name: "git_ssh_key", nullable: true, type: "text" })
    gitSshKey?: string | null;

    @Column({ name: "git_webhook_url", nullable: true })
    gitWebhookUrl?: string;

    @Column({ name: "git_clone_interval", nullable: true, type: "integer" })
    gitCloneInterval?: number;

    @Column({ name: "git_branch", nullable: true })
    gitBranch?: string;

    @Column({ name: "git_https_username", nullable: true, type: 'varchar' })
    gitHttpsUsername?: string | null;

    @Column({ name: "git_https_password", nullable: true, type: "text" })
    gitHttpsPassword?: string | null;

    @Column({ name: "git_getapp_file_path", nullable: true })
    gitGetappFilePath?: string;

    toString() {
        return JSON.stringify(this)
    }
}