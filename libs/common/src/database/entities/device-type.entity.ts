import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("device_type")
export class DeviceTypeEntity {

  @PrimaryColumn({ name: "name" })
  name: string;

  @Column({ name: "description", type: "text", nullable: true })
  description?: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "CURRENT_TIMESTAMP(6)" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "CURRENT_TIMESTAMP(6)" })
  updatedAt: Date;
}