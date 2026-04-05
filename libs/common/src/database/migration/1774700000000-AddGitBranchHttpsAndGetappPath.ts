import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGitBranchHttpsAndGetappPath1774700000000 implements MigrationInterface {
    name = 'AddGitBranchHttpsAndGetappPath1774700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" ADD "git_branch" character varying`);
        await queryRunner.query(`ALTER TABLE "project" ADD "git_https_username" character varying`);
        await queryRunner.query(`ALTER TABLE "project" ADD "git_https_password" text`);
        await queryRunner.query(`ALTER TABLE "project" ADD "git_getapp_file_path" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_getapp_file_path"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_https_password"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_https_username"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "git_branch"`);
    }
}
