import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from '@app/common/AWS/s3.service';

/**
 * Caches the final assembled device config (without resolved vault secrets)
 * in S3 / MinIO via the shared S3Service, keyed by the revision's semantic
 * version string.
 *
 * Cache key format: `config-cache/{deviceId}/{semver}.json`
 *
 * Each successfully applied revision receives its own immutable S3 object,
 * so any historical version can be retrieved without recomputation.
 * Secrets are NEVER stored in the cache – callers must resolve them afterwards.
 */
@Injectable()
export class ConfigCacheService {
  private readonly logger = new Logger(ConfigCacheService.name);

  constructor(private readonly s3Service: S3Service) {}

  /**
   * Try to retrieve a cached config for a device at a specific semver.
   * Returns the parsed config object on a cache hit, or null on a miss /
   * when S3 is not reachable.
   */
  async getByVersion(deviceId: string, semver: string): Promise<Record<string, any> | null> {
    const key = this.versionedObjectKey(deviceId, semver);
    try {
      const result = await this.s3Service.getObjectAsString(key);
      if (!result) return null;
      this.logger.debug(`Config cache hit for device ${deviceId} @ ${semver}`);
      return JSON.parse(result.body);
    } catch (err: any) {
      this.logger.warn(`Config cache get failed for device ${deviceId} @ ${semver}: ${err.message}`);
      return null;
    }
  }

  /**
   * Store a config payload under its semantic version key.
   * `payload` must NOT contain resolved vault secrets.
   */
  async setByVersion(deviceId: string, semver: string, payload: Record<string, any>): Promise<void> {
    const key = this.versionedObjectKey(deviceId, semver);
    try {
      await this.s3Service.putObjectWithContent(key, JSON.stringify(payload), {
        contentType: 'application/json',
      });
      this.logger.debug(`Config cache stored for device ${deviceId} @ ${semver}`);
    } catch (err: any) {
      this.logger.warn(`Config cache set failed for device ${deviceId} @ ${semver}: ${err.message}`);
    }
  }

  private versionedObjectKey(deviceId: string, semver: string): string {
    return `config-cache/${deviceId}/${semver}.json`;
  }
}

