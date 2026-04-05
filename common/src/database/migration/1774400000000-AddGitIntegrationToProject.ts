import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGitIntegrationToProject1774400000000 implements MigrationInterface {
    name = 'AddGitIntegrationToProject1774400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" ADD "git_clone_url" character varying`);
        await queryRunner.query(`ALTER TABLE "project" ADD "git_ssh_key" text`);
        // git_webhook_url stores the server-generated webhook URL (not user-provided)
        await queryRunner.query(`ALTER TABLE "project" ADD "git_webhook_url" character varying`);
        await queryRunner.query(`ALTER TABLE "project" ADD "git_clone_interval" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_clone_interval"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_webhook_url"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_ssh_key"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_clone_url"`);
    }
}
