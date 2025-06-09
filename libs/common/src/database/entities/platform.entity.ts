import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { OS } from "./enums.entity";

@Entity("platform")
export class PlatformEntity {

  @PrimaryColumn({ name: "name" })
  name: string;

  @Column({ name: "description", default: null })
  description?: string;

  @Column({ name: "os", enum: OS, type: 'enum', default: null })
  os?: OS;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "CURRENT_TIMESTAMP(6)" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "CURRENT_TIMESTAMP(6)" })
  updatedAt: Date;
}

