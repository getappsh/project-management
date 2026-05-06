import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayNameToConfigGroup1780200000000 implements MigrationInterface {
  name = 'AddDisplayNameToConfigGroup1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "config_group"
      ADD COLUMN IF NOT EXISTS "display_name" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "config_group" DROP COLUMN IF EXISTS "display_name"`);
  }
}
