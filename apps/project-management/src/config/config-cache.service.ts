import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { S3Service } from '@app/common/AWS/s3.service';

/**
 * Caches the final assembled device config (without resolved vault secrets)
 * in S3 / MinIO via the shared S3Service, keyed by a content-based hash.
 *
 * Cache key format: `config-cache/{deviceId}/latest.json`
 * The S3 object carries a `configHash` metadata field that reflects all
 * revision IDs used to build the config. On a hash match the cached payload
 * is returned directly instead of rebuilding.
 *
 * Secrets are NEVER stored in the cache – callers must resolve them afterwards.
 */
@Injectable()
export class ConfigCacheService {
  private readonly logger = new Logger(ConfigCacheService.name);

  constructor(private readonly s3Service: S3Service) {}

  /**
   * Compute a deterministic cache-invalidation hash from the set of revision
   * IDs that contributed to the final config.
   */
  computeConfigHash(revisionIds: number[]): string {
    const sorted = [...revisionIds].sort((a, b) => a - b);
    return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16);
  }

  /**
   * Try to retrieve a cached config for a device.
   * Returns the parsed config object when the stored hash matches, or null on
   * a cache miss / when S3 is not reachable.
   */
  async get(deviceId: string, expectedHash: string): Promise<Record<string, any> | null> {
    const key = this.objectKey(deviceId);
    try {
      const result = await this.s3Service.getObjectAsString(key);
      if (!result) return null;

      const cachedHash = result.metadata['configHash'];
      if (cachedHash !== expectedHash) {
        this.logger.debug(
          `Config cache miss for device ${deviceId}: hash mismatch (stored=${cachedHash}, expected=${expectedHash})`,
        );
        return null;
      }

      this.logger.debug(`Config cache hit for device ${deviceId}`);
      return JSON.parse(result.body);
    } catch (err: any) {
      this.logger.warn(`Config cache get failed for device ${deviceId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Store a config payload in the cache.
   * `payload` must NOT contain resolved vault secrets.
   */
  async set(deviceId: string, hash: string, payload: Record<string, any>): Promise<void> {
    const key = this.objectKey(deviceId);
    try {
      await this.s3Service.putObjectWithContent(key, JSON.stringify(payload), {
        contentType: 'application/json',
        metadata: { configHash: hash },
      });
      this.logger.debug(`Config cache updated for device ${deviceId} (hash=${hash})`);
    } catch (err: any) {
      this.logger.warn(`Config cache set failed for device ${deviceId}: ${err.message}`);
    }
  }

  private objectKey(deviceId: string): string {
    return `config-cache/${deviceId}/latest.json`;
  }
}

