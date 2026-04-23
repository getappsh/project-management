import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigProjectIdToAssociation1780000000001 implements MigrationInterface {
  name = 'AddConfigProjectIdToAssociation1780000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "config_map_association"
      ADD COLUMN IF NOT EXISTS "config_project_id" integer
      REFERENCES "project"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_config_map_assoc_config_project_id"
      ON "config_map_association" ("config_project_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_config_map_assoc_config_project_id"`);
    await queryRunner.query(`ALTER TABLE "config_map_association" DROP COLUMN IF EXISTS "config_project_id"`);
  }
}
