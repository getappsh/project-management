import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectTypeValuesAndChangeDefault1774600000000 implements MigrationInterface {
    name = 'AddProjectTypeValuesAndChangeDefault1774600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL requires new enum values to be committed before they can be used.
        // Commit the current transaction, add the values, then start a new one.
        await queryRunner.commitTransaction();

        await queryRunner.query(`ALTER TYPE "public"."project_project_type_enum" ADD VALUE IF NOT EXISTS 'application'`);
        await queryRunner.query(`ALTER TYPE "public"."project_project_type_enum" ADD VALUE IF NOT EXISTS 'lib'`);
        await queryRunner.query(`ALTER TYPE "public"."project_project_type_enum" ADD VALUE IF NOT EXISTS 'bundle'`);
        await queryRunner.query(`ALTER TYPE "public"."project_project_type_enum" ADD VALUE IF NOT EXISTS 'infra'`);

        await queryRunner.startTransaction();

        // Migrate existing 'product' records to 'application'
        await queryRunner.query(`UPDATE "project" SET "project_type" = 'application' WHERE "project_type" = 'product'`);

        // Update the column default
        await queryRunner.query(`ALTER TABLE "project" ALTER COLUMN "project_type" SET DEFAULT 'application'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert default
        await queryRunner.query(`ALTER TABLE "project" ALTER COLUMN "project_type" SET DEFAULT 'product'`);

        // Revert migrated records
        await queryRunner.query(`UPDATE "project" SET "project_type" = 'product' WHERE "project_type" = 'application'`);

        // Note: PostgreSQL does not support removing enum values directly.
        // The added values (application, lib, bundle, infra) will remain in the enum type.
    }
}
