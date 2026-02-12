import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDeploymentReportCacheTable1770879522402 implements MigrationInterface {
    name = 'CreateDeploymentReportCacheTable1770879522402'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rule_device_types" DROP CONSTRAINT "FK_rule_device_types_device_type"`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" DROP CONSTRAINT "FK_rule_device_types_rule"`);
        await queryRunner.query(`ALTER TABLE "rule_devices" DROP CONSTRAINT "FK_rule_devices_device"`);
        await queryRunner.query(`ALTER TABLE "rule_devices" DROP CONSTRAINT "FK_rule_devices_rule"`);
        await queryRunner.query(`ALTER TABLE "rule_os" DROP CONSTRAINT "FK_rule_os_rule"`);
        await queryRunner.query(`ALTER TABLE "rule_releases" DROP CONSTRAINT "FK_rule_releases_release"`);
        await queryRunner.query(`ALTER TABLE "rule_releases" DROP CONSTRAINT "FK_rule_releases_rule"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rule_device_types_rule_device_type"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rule_devices_rule_device"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rule_os_rule_osType"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rules_type_isActive"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rule_releases_rule_release"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rule_fields_name"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pending_version_project_version"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pending_version_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pending_version_last_reported"`);
        await queryRunner.query(`CREATE TABLE "deployment_report_cache" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "report_data" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cached_at" TIMESTAMP WITH TIME ZONE NOT NULL, "project_id" integer NOT NULL, CONSTRAINT "PK_123cc035a6b8cb062c7c7ad0920" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_deployment_report_cache_project_date" ON "deployment_report_cache" ("project_id", "cached_at") `);
        await queryRunner.query(`ALTER TABLE "discovery_message" DROP COLUMN "meta_data"`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ALTER COLUMN "rule_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ALTER COLUMN "device_type_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ALTER COLUMN "rule_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ALTER COLUMN "device_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_os" ALTER COLUMN "rule_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TYPE "public"."rule_type_enum" RENAME TO "rule_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."rules_type_enum" AS ENUM('policy', 'restriction')`);
        await queryRunner.query(`ALTER TABLE "rules" ALTER COLUMN "type" TYPE "public"."rules_type_enum" USING "type"::"text"::"public"."rules_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."rule_type_enum_old"`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ALTER COLUMN "rule_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ALTER COLUMN "release_catalog_id" DROP NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0e06d7b31072b604aa89e80ce6" ON "rule_device_types" ("rule_id", "device_type_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e22739e9161ee39013fceeb97b" ON "rule_devices" ("rule_id", "device_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_66eab3a0e21de00f00a5bb8a5b" ON "rule_os" ("rule_id", "osType") `);
        await queryRunner.query(`CREATE INDEX "IDX_982d910584336e66184c0941f7" ON "rules" ("type", "isActive") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e946c8ee00f654ff85524090dc" ON "rule_releases" ("rule_id", "release_catalog_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_16f948698511bdc516bd70a352" ON "rule_fields" ("name") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d5107d1072df10804e7acf9f4d" ON "pending_version" ("project_name", "version") `);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ADD CONSTRAINT "FK_ea21862ed13c9476060459588b6" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ADD CONSTRAINT "FK_65240a6258f4380efe408ab8243" FOREIGN KEY ("device_type_id") REFERENCES "device_type"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ADD CONSTRAINT "FK_13d5bb10a3264d00c86a021957b" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ADD CONSTRAINT "FK_bb8b77aab462d23f1412b516f4e" FOREIGN KEY ("device_id") REFERENCES "device"("ID") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_os" ADD CONSTRAINT "FK_ac63f4473baf9b0451f0b08430e" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ADD CONSTRAINT "FK_f2679c3a11106ee6fc552089944" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ADD CONSTRAINT "FK_6372a20912c4ed2f85920decc0f" FOREIGN KEY ("release_catalog_id") REFERENCES "release"("catalog_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deployment_report_cache" ADD CONSTRAINT "FK_6037c4222daa5c770861cd5ab18" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "deployment_report_cache" DROP CONSTRAINT "FK_6037c4222daa5c770861cd5ab18"`);
        await queryRunner.query(`ALTER TABLE "rule_releases" DROP CONSTRAINT "FK_6372a20912c4ed2f85920decc0f"`);
        await queryRunner.query(`ALTER TABLE "rule_releases" DROP CONSTRAINT "FK_f2679c3a11106ee6fc552089944"`);
        await queryRunner.query(`ALTER TABLE "rule_os" DROP CONSTRAINT "FK_ac63f4473baf9b0451f0b08430e"`);
        await queryRunner.query(`ALTER TABLE "rule_devices" DROP CONSTRAINT "FK_bb8b77aab462d23f1412b516f4e"`);
        await queryRunner.query(`ALTER TABLE "rule_devices" DROP CONSTRAINT "FK_13d5bb10a3264d00c86a021957b"`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" DROP CONSTRAINT "FK_65240a6258f4380efe408ab8243"`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" DROP CONSTRAINT "FK_ea21862ed13c9476060459588b6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d5107d1072df10804e7acf9f4d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_16f948698511bdc516bd70a352"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e946c8ee00f654ff85524090dc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_982d910584336e66184c0941f7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_66eab3a0e21de00f00a5bb8a5b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e22739e9161ee39013fceeb97b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e06d7b31072b604aa89e80ce6"`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ALTER COLUMN "release_catalog_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ALTER COLUMN "rule_id" SET NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."rule_type_enum_old" AS ENUM('policy', 'restriction')`);
        await queryRunner.query(`ALTER TABLE "rules" ALTER COLUMN "type" TYPE "public"."rule_type_enum_old" USING "type"::"text"::"public"."rule_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."rules_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."rule_type_enum_old" RENAME TO "rule_type_enum"`);
        await queryRunner.query(`ALTER TABLE "rule_os" ALTER COLUMN "rule_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ALTER COLUMN "device_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ALTER COLUMN "rule_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ALTER COLUMN "device_type_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ALTER COLUMN "rule_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "discovery_message" ADD "meta_data" jsonb`);
        await queryRunner.query(`DROP INDEX "public"."idx_deployment_report_cache_project_date"`);
        await queryRunner.query(`DROP TABLE "deployment_report_cache"`);
        await queryRunner.query(`CREATE INDEX "IDX_pending_version_last_reported" ON "pending_version" ("last_reported_date") `);
        await queryRunner.query(`CREATE INDEX "IDX_pending_version_status" ON "pending_version" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_pending_version_project_version" ON "pending_version" ("project_name", "version") `);
        await queryRunner.query(`CREATE INDEX "IDX_rule_fields_name" ON "rule_fields" ("name") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_rule_releases_rule_release" ON "rule_releases" ("rule_id", "release_catalog_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_rules_type_isActive" ON "rules" ("type", "isActive") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_rule_os_rule_osType" ON "rule_os" ("rule_id", "osType") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_rule_devices_rule_device" ON "rule_devices" ("rule_id", "device_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_rule_device_types_rule_device_type" ON "rule_device_types" ("rule_id", "device_type_id") `);
        await queryRunner.query(`ALTER TABLE "rule_releases" ADD CONSTRAINT "FK_rule_releases_rule" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_releases" ADD CONSTRAINT "FK_rule_releases_release" FOREIGN KEY ("release_catalog_id") REFERENCES "release"("catalog_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_os" ADD CONSTRAINT "FK_rule_os_rule" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ADD CONSTRAINT "FK_rule_devices_rule" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_devices" ADD CONSTRAINT "FK_rule_devices_device" FOREIGN KEY ("device_id") REFERENCES "device"("ID") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ADD CONSTRAINT "FK_rule_device_types_rule" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rule_device_types" ADD CONSTRAINT "FK_rule_device_types_device_type" FOREIGN KEY ("device_type_id") REFERENCES "device_type"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
