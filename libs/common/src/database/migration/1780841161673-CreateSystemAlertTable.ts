import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSystemAlertTable1780841161673 implements MigrationInterface {
    name = 'CreateSystemAlertTable1780841161673'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "system_alert" ("id" SERIAL NOT NULL, "createdDate" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastUpdatedDate" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(50) NOT NULL, "severity" character varying(20) NOT NULL, "message" text NOT NULL, "device_id" character varying, "catalog_id" character varying, "source" character varying(50), "metadata" jsonb, CONSTRAINT "PK_8d2a4a6c76400e9027cc1d68158" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_08cb7e442159637d0d8d4ca3d6" ON "system_alert" ("type") `);
        await queryRunner.query(`CREATE INDEX "IDX_10f6c6ecbd4eef7bd7b48217ca" ON "system_alert" ("device_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_10f6c6ecbd4eef7bd7b48217ca"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_08cb7e442159637d0d8d4ca3d6"`);
        await queryRunner.query(`DROP TABLE "system_alert"`);
    }
}
