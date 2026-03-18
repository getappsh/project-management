import { MigrationInterface, QueryRunner } from "typeorm";
import { DEFAULT_ALLOW_ALL_DEVICES_RULE_ID } from "../../rules/constants";

export class UpdateDefaultAllowAllDevicesRule1771500000000 implements MigrationInterface {
    name = 'UpdateDefaultAllowAllDevicesRule1771500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "rules"
            SET "rule" = '{"conditions":[{"or":[{"field":"$.device.any","value":true,"operator":"equals"},{"field":"device.any","value":true,"operator":"equals"}]}]}'::jsonb
            WHERE "id" = '${DEFAULT_ALLOW_ALL_DEVICES_RULE_ID}'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "rules"
            SET "rule" = '{"conditions":[{"and":[{"field":"$.device.any","value":true,"operator":"equals"}]}]}'::jsonb
            WHERE "id" = '${DEFAULT_ALLOW_ALL_DEVICES_RULE_ID}'
        `);
    }
}
