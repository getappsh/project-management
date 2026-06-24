import { MigrationInterface, QueryRunner } from "typeorm";

export class SupportAlertsByProjectId1782285439912 implements MigrationInterface {
    name = 'SupportAlertsByProjectId1782285439912'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_alert" ADD "project_id" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_08abc5413fbf055ab4ffe30409" ON "system_alert" ("project_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_08abc5413fbf055ab4ffe30409"`);
        await queryRunner.query(`ALTER TABLE "system_alert" DROP COLUMN "project_id"`);
    }

}
