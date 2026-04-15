import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectGitSourceEntity } from '@app/common/database/entities';
import { VaultService } from '@app/common/vault';

/**
 * Runs once on application startup.
 *
 * When HashiCorp Vault is enabled (VAULT_ADDR is set) and any git-source records
 * still contain plain-text SSH keys or HTTPS passwords, this service migrates them
 * to Vault and replaces the DB column value with the Vault reference string.
 *
 * This is a one-time, idempotent migration – records that already contain a Vault
 * reference are skipped.
 */
@Injectable()
export class VaultCredentialsMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VaultCredentialsMigrationService.name);

  constructor(
    @InjectRepository(ProjectGitSourceEntity)
    private readonly gitSourceRepo: Repository<ProjectGitSourceEntity>,
    private readonly vaultService: VaultService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.vaultService.isEnabled) {
      return;
    }

    this.logger.log(
      'Vault is enabled – scanning for plain-text credentials to migrate…',
    );

    try {
      await this.migrateCredentials();
    } catch (error) {
      // Log but do not crash the service; records can be re-migrated on next boot
      this.logger.error(
        `Vault credential migration encountered an error: ${error.message}`,
        error.stack,
      );
    }
  }

  private async migrateCredentials(): Promise<void> {
    const gitSources = await this.gitSourceRepo.find();

    let migrated = 0;

    for (const gitSource of gitSources) {
      let updated = false;

      // Migrate SSH key
      if (gitSource.sshKey && !this.vaultService.isVaultRef(gitSource.sshKey)) {
        this.logger.log(
          `Migrating plain-text SSH key to Vault for git source id=${gitSource.id}`,
        );
        gitSource.sshKey = await this.vaultService.storeSecret(
          gitSource.id,
          'ssh_key',
          gitSource.sshKey,
        );
        updated = true;
      }

      // Migrate HTTPS password
      if (
        gitSource.httpsPassword &&
        !this.vaultService.isVaultRef(gitSource.httpsPassword)
      ) {
        this.logger.log(
          `Migrating plain-text HTTPS password to Vault for git source id=${gitSource.id}`,
        );
        gitSource.httpsPassword = await this.vaultService.storeSecret(
          gitSource.id,
          'https_password',
          gitSource.httpsPassword,
        );
        updated = true;
      }

      if (updated) {
        await this.gitSourceRepo.save(gitSource);
        migrated++;
      }
    }

    if (migrated > 0) {
      this.logger.log(`Vault migration complete – moved ${migrated} git source(s) to Vault`);
    } else {
      this.logger.log('Vault migration: no plain-text credentials found, nothing to migrate');
    }
  }
}
