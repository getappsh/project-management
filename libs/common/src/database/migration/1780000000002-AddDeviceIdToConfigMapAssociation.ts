import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceIdToConfigMapAssociation1780000000002 implements MigrationInterface {
  name = 'AddDeviceIdToConfigMapAssociation1780000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "config_map_association"
      ADD COLUMN IF NOT EXISTS "device_id" character varying
      REFERENCES "device"("ID") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_config_map_assoc_device_id"
      ON "config_map_association" ("device_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_config_map_assoc_device_id"`);
    await queryRunner.query(`ALTER TABLE "config_map_association" DROP COLUMN IF EXISTS "device_id"`);
  }
}
