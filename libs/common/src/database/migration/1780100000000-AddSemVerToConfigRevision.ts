import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSemVerToConfigRevision1780100000000 implements MigrationInterface {
  name = 'AddSemVerToConfigRevision1780100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "config_revision"
      ADD COLUMN IF NOT EXISTS "sem_ver" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "config_revision" DROP COLUMN IF EXISTS "sem_ver"`);
  }
}
