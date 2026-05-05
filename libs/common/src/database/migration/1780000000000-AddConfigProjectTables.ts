import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigProjectTables1780000000000 implements MigrationInterface {
  name = 'AddConfigProjectTables1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. Extend project_project_type_enum with config + config_map values
    //    PostgreSQL requires the transaction to be committed before a new enum
    //    value can be used in DDL, so we commit/restart around the ALTER TYPE.
    // -------------------------------------------------------------------------
    await queryRunner.commitTransaction();

    await queryRunner.query(`ALTER TYPE "public"."project_project_type_enum" ADD VALUE IF NOT EXISTS 'config'`);
    await queryRunner.query(`ALTER TYPE "public"."project_project_type_enum" ADD VALUE IF NOT EXISTS 'config_map'`);

    await queryRunner.startTransaction();

    // -------------------------------------------------------------------------
    // 2. config_revision_status enum
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "public"."config_revision_status_enum"
      AS ENUM ('draft', 'active', 'archived')
    `);

    // -------------------------------------------------------------------------
    // 3. config_revision table
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "config_revision" (
        "id"               SERIAL NOT NULL,
        "project_id"       integer NOT NULL,
        "revision_number"  integer NOT NULL,
        "status"           "public"."config_revision_status_enum" NOT NULL DEFAULT 'draft',
        "applied_by"       character varying,
        "applied_at"       TIMESTAMP WITH TIME ZONE,
        "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_config_revision" PRIMARY KEY ("id"),
        CONSTRAINT "FK_config_revision_project"
          FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_config_revision_project_id" ON "config_revision" ("project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_config_revision_status"     ON "config_revision" ("status")`);

    // -------------------------------------------------------------------------
    // 4. config_group table (stores group config as a YAML string)
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "config_group" (
        "id"             SERIAL NOT NULL,
        "revision_id"    integer NOT NULL,
        "name"           character varying NOT NULL,
        "is_global"      boolean NOT NULL DEFAULT false,
        "git_file_path"  character varying,
        "yaml_content"   text,
        "sensitive_keys" jsonb NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_config_group" PRIMARY KEY ("id"),
        CONSTRAINT "FK_config_group_revision"
          FOREIGN KEY ("revision_id") REFERENCES "config_revision"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_config_group_revision_id" ON "config_group" ("revision_id")`);

    // -------------------------------------------------------------------------
    // 5. config_map_association table
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "config_map_association" (
        "id"                    SERIAL NOT NULL,
        "config_map_project_id" integer NOT NULL,
        "device_type_id"        integer,
        "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_config_map_association" PRIMARY KEY ("id"),
        CONSTRAINT "FK_config_map_association_project"
          FOREIGN KEY ("config_map_project_id") REFERENCES "project"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_config_map_association_device_type"
          FOREIGN KEY ("device_type_id") REFERENCES "device_type"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_config_map_assoc_project_id"     ON "config_map_association" ("config_map_project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_config_map_assoc_device_type_id" ON "config_map_association" ("device_type_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "config_map_association"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "config_group"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "config_revision"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."config_revision_status_enum"`);
    // Note: PostgreSQL does not support removing enum values, so 'config' and
    // 'config_map' will remain in project_project_type_enum.
  }
}
