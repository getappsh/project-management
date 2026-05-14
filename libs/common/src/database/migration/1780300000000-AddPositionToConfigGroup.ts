import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPositionToConfigGroup1780300000000 implements MigrationInterface {
  name = 'AddPositionToConfigGroup1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "config_group"
      ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0
    `);

    // Backfill existing rows: assign positions based on current id order within each revision
    await queryRunner.query(`
      UPDATE "config_group" cg
      SET "position" = sub.rn - 1
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY revision_id ORDER BY id) AS rn
        FROM "config_group"
      ) sub
      WHERE cg.id = sub.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "config_group" DROP COLUMN IF EXISTS "position"`);
  }
}
