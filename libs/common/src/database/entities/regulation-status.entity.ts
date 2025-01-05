import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { RegulationEntity } from "./regulation.entity";
import { UploadVersionEntity } from "./upload-version.entity";

@Entity("regulation_status")
@Unique("regulation_version_unique_constraint",['regulation', 'version'])
export class RegulationStatusEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @ManyToOne(() => UploadVersionEntity, (version) => version)
    @JoinColumn({name: "version_id"})
    version: UploadVersionEntity

    @ManyToOne(() => RegulationEntity, (regulation) => regulation)
    @JoinColumn({name: "regulation_id"})
    regulation: RegulationEntity;

    @Column({name: "is_compliant", default: false})
    isCompliant: boolean;

    @Column({ name: "value", default: null })
    value: string;

    @Column({ name: "report_details", default: null })
    reportDetails: string;
}
