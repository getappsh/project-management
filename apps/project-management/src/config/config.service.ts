import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as yaml from 'js-yaml';
import {
  ConfigGroupEntity,
  ConfigMapAssociationEntity,
  ConfigRevisionEntity,
  ConfigRevisionStatus,
  ProjectEntity,
  ProjectType,
} from '@app/common/database/entities';
import {
  AddConfigMapAssociationDto,
  ApplyConfigRevisionDto,
  ConfigGroupDto,
  ConfigMapAssociationDto,
  ConfigMapForProjectDto,
  ConfigRevisionDto,
  DeleteConfigGroupDto,
  DeviceConfigDto,
  GetConfigRevisionByIdDto,
  GetConfigRevisionsDto,
  GetDeviceConfigByVersionDto,
  GetDeviceConfigDto,
  RemoveConfigMapAssociationDto,
  UpsertConfigGroupDto,
} from '@app/common/dto/project-management';
import { VaultService } from '@app/common/vault';
import { ConfigCacheService } from './config-cache.service';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { DeviceTopics, DevicesHierarchyTopics } from '@app/common/microservice-client/topics';
import { lastValueFrom } from 'rxjs';

const CONFIG_VAULT_FIELD = 'config_value' as const;
/** One Vault secret per sensitive key path; dots in the path become '__'. */
const CONFIG_VAULT_KEY_SECRET_NAME = (groupId: number, keyPath: string) =>
  `config-group-${groupId}-key-${keyPath.replace(/\./g, '__')}`;

// ---------------------------------------------------------------------------
// Dot-notation path helpers for nested YAML objects
// ---------------------------------------------------------------------------

function getByPath(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((curr: any, key: string) => curr?.[key], obj as any);
}

function setByPath(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let curr: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (curr[parts[i]] == null || typeof curr[parts[i]] !== 'object') curr[parts[i]] = {};
    curr = curr[parts[i]];
  }
  curr[parts[parts.length - 1]] = value;
}

function deleteByPath(obj: Record<string, any>, path: string): void {
  const parts = path.split('.');
  let curr: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (curr[parts[i]] == null) return;
    curr = curr[parts[i]];
  }
  delete curr[parts[parts.length - 1]];
}

@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ConfigRevisionEntity) private readonly revisionRepo: Repository<ConfigRevisionEntity>,
    @InjectRepository(ConfigGroupEntity) private readonly groupRepo: Repository<ConfigGroupEntity>,
    @InjectRepository(ConfigMapAssociationEntity) private readonly assocRepo: Repository<ConfigMapAssociationEntity>,
    private readonly vaultService: VaultService,
    private readonly cacheService: ConfigCacheService,
    @Inject(MicroserviceName.DEVICE_SERVICE) private readonly deviceClient: MicroserviceClient,
  ) {}

  async onModuleInit() {
    this.deviceClient.subscribeToResponseOf([
      DeviceTopics.GET_DEVICE_TYPE_IDS_FOR_DEVICE,
      DeviceTopics.GET_DEVICE_IDS_BY_TYPE_IDS,
      DeviceTopics.GET_ALL_DEVICE_IDS,
      DevicesHierarchyTopics.GET_DEVICE_TYPE_BY_NAME,
    ]);
    await this.deviceClient.connect();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private findProjectCondition(identifier: number | string) {
    return typeof identifier === 'number' ? { id: identifier } : { name: identifier };
  }

  private async requireProject(
    identifier: number | string,
    expectedType?: ProjectType | ProjectType[],
  ): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOne({ where: this.findProjectCondition(identifier) });
    if (!project) throw new NotFoundException(`Project not found: ${identifier}`);
    if (expectedType) {
      const types = Array.isArray(expectedType) ? expectedType : [expectedType];
      if (!types.includes(project.projectType)) {
        throw new BadRequestException(
          `Project '${identifier}' is of type '${project.projectType}', expected one of: ${types.join(', ')}`,
        );
      }
    }
    return project;
  }

  /**
   * Parses a YAML string into a plain object. Returns an empty object on
   * null/undefined input or parse errors so callers never receive null.
   */
  private parseYaml(content: string | null | undefined): Record<string, any> {
    if (!content) return {};
    try {
      const parsed = yaml.load(content);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, any>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Returns the current DRAFT revision for a project, creating one if none exists.
   * New revisions start at revisionNumber = 1 or max(existing) + 1.
   */
  async getOrCreateDraftRevision(projectId: number): Promise<ConfigRevisionEntity> {
    const existing = await this.revisionRepo.findOne({
      where: { projectId, status: ConfigRevisionStatus.DRAFT },
    });
    if (existing) return existing;

    const maxResult = await this.revisionRepo
      .createQueryBuilder('r')
      .select('MAX(r.revisionNumber)', 'max')
      .where('r.projectId = :projectId', { projectId })
      .getRawOne<{ max: number | null }>();

    const nextNumber = (maxResult?.max ?? 0) + 1;
    const draft = this.revisionRepo.create({
      projectId,
      revisionNumber: nextNumber,
      status: ConfigRevisionStatus.DRAFT,
    });
    return this.revisionRepo.save(draft);
  }

  // ---------------------------------------------------------------------------
  // Group CRUD (operates on the current DRAFT revision)
  // ---------------------------------------------------------------------------

  async upsertGroup(dto: UpsertConfigGroupDto): Promise<ConfigGroupDto> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);

    const draft = await this.getOrCreateDraftRevision(project.id);

    let group = await this.groupRepo.findOne({
      where: { revisionId: draft.id, name: dto.name },
    });

    if (!group) {
      group = this.groupRepo.create({ revisionId: draft.id, name: dto.name });
    }

    group.isGlobal = dto.isGlobal ?? group.isGlobal ?? false;
    group.gitFilePath = dto.gitFilePath ?? group.gitFilePath ?? null;

    // Update sensitive key list when explicitly provided
    if (dto.sensitiveKeys !== undefined) {
      group.sensitiveKeys = dto.sensitiveKeys;
    }
    group.sensitiveKeys = group.sensitiveKeys ?? [];

    if (dto.yamlContent !== undefined) {
      const parsed = this.parseYaml(dto.yamlContent);

      // If the user submits '***' for a sensitive key (the masked placeholder returned by the API),
      // restore the existing stored value so the secret is not lost.
      if (group.sensitiveKeys.length > 0 && group.yamlContent) {
        const existingParsed = this.parseYaml(group.yamlContent);
        for (const keyPath of group.sensitiveKeys) {
          if (getByPath(parsed, keyPath) === '***') {
            const existingValue = getByPath(existingParsed, keyPath);
            if (existingValue != null) {
              setByPath(parsed, keyPath, existingValue);
            } else {
              deleteByPath(parsed, keyPath);
            }
          }
        }
      }

      if (group.sensitiveKeys.length > 0 && this.vaultService.isEnabled) {
        // Ensure we have a persisted ID before naming vault secrets
        if (!group.id) {
          const partial = await this.groupRepo.save(group);
          group.id = partial.id;
        }

        for (const keyPath of group.sensitiveKeys) {
          const value = getByPath(parsed, keyPath);
          if (value != null && !this.vaultService.isVaultRef(String(value))) {
            const vaultRef = await this.vaultService.storeSecret(
              CONFIG_VAULT_KEY_SECRET_NAME(group.id, keyPath),
              CONFIG_VAULT_FIELD,
              String(value),
              { projectId: String(project.id), groupName: dto.name, keyPath },
            );
            setByPath(parsed, keyPath, vaultRef);
          }
          // Already a vault ref → leave as-is
        }
      }

      group.yamlContent = Object.keys(parsed).length > 0 ? yaml.dump(parsed) : null;
    }

    const saved = await this.groupRepo.save(group);
    return this.mapGroupToDto(saved);
  }

  async deleteGroup(dto: DeleteConfigGroupDto): Promise<{ success: boolean }> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);
    const draft = await this.getOrCreateDraftRevision(project.id);
    const group = await this.groupRepo.findOne({ where: { revisionId: draft.id, name: dto.groupName } });
    if (!group) throw new NotFoundException(`Group '${dto.groupName}' not found in draft revision`);

    await this.deleteGroupVaultSecrets(group);
    await this.groupRepo.remove(group);
    return { success: true };
  }

  /** Deletes Vault secrets for every sensitive key in a group. */
  private async deleteGroupVaultSecrets(group: ConfigGroupEntity): Promise<void> {
    if (!this.vaultService.isEnabled || !group.sensitiveKeys?.length || !group.yamlContent) return;
    const parsed = this.parseYaml(group.yamlContent);
    for (const keyPath of group.sensitiveKeys) {
      const value = getByPath(parsed, keyPath);
      if (value != null && this.vaultService.isVaultRef(String(value))) {
        await this.vaultService
          .deleteSecret(CONFIG_VAULT_KEY_SECRET_NAME(group.id, keyPath), CONFIG_VAULT_FIELD)
          .catch((err) =>
            this.logger.warn(
              `Failed to delete Vault secret for group ${group.id} key '${keyPath}': ${(err as Error)?.message}`,
            ),
          );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Revision lifecycle
  // ---------------------------------------------------------------------------

  async applyRevision(dto: ApplyConfigRevisionDto): Promise<ConfigRevisionDto> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);

    const draft = await this.revisionRepo.findOne({
      where: { projectId: project.id, status: ConfigRevisionStatus.DRAFT },
      relations: { groups: true },
    });
    if (!draft) throw new NotFoundException(`No draft revision found for project '${dto.projectIdentifier}'`);

    const previousActive = await this.revisionRepo.findOne({
      where: { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
      relations: { groups: true },
    });

    await this.revisionRepo.update(
      { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
      { status: ConfigRevisionStatus.ARCHIVED },
    );

    draft.semVer = this.computeNextSemVer(
      previousActive?.groups,
      draft.groups ?? [],
      previousActive?.semVer ?? null,
    );

    draft.status = ConfigRevisionStatus.ACTIVE;
    draft.appliedBy = dto.appliedBy ?? null;
    draft.appliedAt = new Date();
    await this.revisionRepo.save(draft);

    this.logger.log(
      `Applied revision ${draft.id} (rev#${draft.revisionNumber}, v${draft.semVer}) for project ${project.id}`,
    );

    if (project.projectType === ProjectType.CONFIG && project.name.startsWith('config:')) {
      const deviceId = project.name.slice('config:'.length);
      this.assembleAndCacheDeviceConfig(deviceId, draft.semVer).catch((err) =>
        this.logger.error(
          `Failed to write config cache for device ${deviceId} @ ${draft.semVer}: ${(err as Error)?.message}`,
        ),
      );
    }

    if (project.projectType === ProjectType.CONFIG_MAP) {
      this.cascadeConfigMapRevisionToDevices(project.id).catch((err) =>
        this.logger.error(`Config map cascade update failed for project ${project.id}: ${(err as Error)?.message}`),
      );
    }

    return this.mapRevisionToDto(draft, true);
  }

  async getActiveConfigSemVerForDevice(deviceId: string): Promise<{ semVer: string | null }> {
    const projectName = `config:${deviceId}`;
    const configProject = await this.projectRepo.findOne({
      where: { name: projectName, projectType: ProjectType.CONFIG },
      select: ['id'],
    });
    if (!configProject) return { semVer: null };
    const revision = await this.revisionRepo.findOne({
      where: { projectId: configProject.id, status: ConfigRevisionStatus.ACTIVE },
      select: ['semVer'],
    });
    return { semVer: revision?.semVer ?? null };
  }

  async getRevisions(dto: GetConfigRevisionsDto): Promise<ConfigRevisionDto[]> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);
    const revisions = await this.revisionRepo.find({
      where: { projectId: project.id },
      order: { revisionNumber: 'DESC' },
      relations: dto.includeGroups ? { groups: true } : undefined,
    });
    return revisions.map((r) => this.mapRevisionToDto(r, dto.includeGroups ?? false));
  }

  async getRevisionById(dto: GetConfigRevisionByIdDto): Promise<ConfigRevisionDto> {
    const revision = await this.revisionRepo.findOne({
      where: { id: dto.revisionId },
      relations: dto.includeGroups ? { groups: true } : undefined,
    });
    if (!revision) throw new NotFoundException(`Revision ${dto.revisionId} not found`);
    return this.mapRevisionToDto(revision, dto.includeGroups ?? false);
  }

  async createDraftRevision(dto: { projectIdentifier: number | string }): Promise<ConfigRevisionDto> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);

    const existing = await this.revisionRepo.findOne({
      where: { projectId: project.id, status: ConfigRevisionStatus.DRAFT },
    });
    if (existing) throw new BadRequestException(`A draft revision already exists for project '${dto.projectIdentifier}'`);

    const maxResult = await this.revisionRepo
      .createQueryBuilder('r')
      .select('MAX(r.revisionNumber)', 'max')
      .where('r.projectId = :projectId', { projectId: project.id })
      .getRawOne<{ max: number | null }>();
    const nextNumber = (maxResult?.max ?? 0) + 1;

    const draft = await this.revisionRepo.save(
      this.revisionRepo.create({ projectId: project.id, revisionNumber: nextNumber, status: ConfigRevisionStatus.DRAFT }),
    );

    const source =
      (await this.revisionRepo.findOne({
        where: { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: true },
      })) ??
      (await this.revisionRepo.findOne({
        where: { projectId: project.id, status: ConfigRevisionStatus.ARCHIVED },
        order: { revisionNumber: 'DESC' },
        relations: { groups: true },
      }));

    if (source?.groups?.length) {
      for (const g of source.groups) {
        await this.cloneGroupToRevision(g, draft.id);
      }
      draft.groups = await this.groupRepo.find({ where: { revisionId: draft.id } });
    }

    this.logger.log(
      `Created draft revision ${draft.id} (rev#${draft.revisionNumber}) for project ${project.id}` +
        (source ? ` (copied from rev#${source.revisionNumber})` : ''),
    );
    return this.mapRevisionToDto(draft, false);
  }

  async deleteDraftRevision(dto: { projectIdentifier: number | string }): Promise<{ success: boolean }> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);

    const draft = await this.revisionRepo.findOne({
      where: { projectId: project.id, status: ConfigRevisionStatus.DRAFT },
      relations: { groups: true },
    });
    if (!draft) throw new NotFoundException(`No draft revision found for project '${dto.projectIdentifier}'`);

    if (this.vaultService.isEnabled) {
      for (const group of draft.groups ?? []) {
        await this.deleteGroupVaultSecrets(group);
      }
    }

    await this.revisionRepo.remove(draft);
    this.logger.log(`Deleted draft revision ${draft.id} for project ${project.id}`);
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // ConfigMap Associations
  // ---------------------------------------------------------------------------

  async addConfigMapAssociation(dto: AddConfigMapAssociationDto): Promise<ConfigMapAssociationDto[]> {
    if (!dto.configMapProjectIdentifier) {
      throw new BadRequestException('configMapProjectIdentifier is required');
    }

    const hasDeviceType = dto.deviceTypeId != null;
    const hasDeviceIds = dto.deviceIds && dto.deviceIds.length > 0;
    if (!hasDeviceType && !hasDeviceIds) {
      throw new BadRequestException('At least one association target must be provided: deviceTypeId or deviceIds');
    }

    const project = await this.requireProject(dto.configMapProjectIdentifier, ProjectType.CONFIG_MAP);

    const created: ConfigMapAssociationDto[] = [];

    if (hasDeviceType) {
      await lastValueFrom(
        this.deviceClient.send(DevicesHierarchyTopics.GET_DEVICE_TYPE_BY_NAME, { deviceTypeId: dto.deviceTypeId }),
      ).catch(() => { throw new NotFoundException(`Device type ${dto.deviceTypeId} not found`); });

      const existingDt = await this.assocRepo.findOne({
        where: { configMapProjectId: project.id, deviceTypeId: dto.deviceTypeId },
      });
      if (existingDt) {
        created.push({ id: existingDt.id, configMapProjectId: existingDt.configMapProjectId, deviceTypeId: existingDt.deviceTypeId, deviceId: null, configProjectId: null });
      } else {
        const assoc = await this.assocRepo.save(
          this.assocRepo.create({
            configMapProjectId: project.id,
            deviceTypeId: dto.deviceTypeId,
            deviceId: null,
            configProjectId: null,
          }),
        );
        created.push({ id: assoc.id, configMapProjectId: assoc.configMapProjectId, deviceTypeId: assoc.deviceTypeId, deviceId: null, configProjectId: null });
      }
    }

    if (hasDeviceIds) {
      for (const deviceId of dto.deviceIds!) {
        const existingDevice = await this.assocRepo.findOne({
          where: { configMapProjectId: project.id, deviceId },
        });
        if (existingDevice) {
          created.push({ id: existingDevice.id, configMapProjectId: existingDevice.configMapProjectId, deviceTypeId: null, deviceId: existingDevice.deviceId ?? null, configProjectId: null });
        } else {
          const assoc = await this.assocRepo.save(
            this.assocRepo.create({
              configMapProjectId: project.id,
              deviceTypeId: null,
              deviceId,
              configProjectId: null,
            }),
          );
          created.push({ id: assoc.id, configMapProjectId: assoc.configMapProjectId, deviceTypeId: null, deviceId: assoc.deviceId ?? null, configProjectId: null });
        }
      }
    }

    return created;
  }

  async removeConfigMapAssociation(dto: RemoveConfigMapAssociationDto): Promise<{ success: boolean }> {
    const assoc = await this.assocRepo.findOne({ where: { id: dto.associationId } });
    if (!assoc) throw new NotFoundException(`Association ${dto.associationId} not found`);
    await this.assocRepo.remove(assoc);
    return { success: true };
  }

  async getConfigMapAssociations(configMapProjectIdentifier: number | string): Promise<ConfigMapAssociationDto[]> {
    const project = await this.requireProject(configMapProjectIdentifier, ProjectType.CONFIG_MAP);
    const assocs = await this.assocRepo.find({ where: { configMapProjectId: project.id, configProjectId: IsNull() } });
    return assocs.map((a) => ({ id: a.id, configMapProjectId: a.configMapProjectId, deviceTypeId: a.deviceTypeId, deviceId: a.deviceId ?? null, configProjectId: null }));
  }

  async getConfigMapsForProject(projectIdentifier: number | string): Promise<ConfigMapForProjectDto[]> {
    const configProject = await this.requireProject(projectIdentifier, ProjectType.CONFIG);

    const deviceId = configProject.name.startsWith('config:')
      ? configProject.name.slice('config:'.length)
      : null;

    const deviceTypeIds: number[] = [];
    if (deviceId) {
      const ids = await lastValueFrom(
        this.deviceClient.send<number[]>(DeviceTopics.GET_DEVICE_TYPE_IDS_FOR_DEVICE, deviceId),
      ).catch(() => [] as number[]);
      deviceTypeIds.push(...ids);
    }

    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull(), deviceId: IsNull(), configProjectId: IsNull() },
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
        ...(deviceId ? [{ deviceId }] : []),
      ],
    });

    if (applicableAssocs.length === 0) return [];

    const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
    const configMapProjects = await this.projectRepo.find({ where: { id: In(configMapProjectIds) } });
    const projectMap = new Map(configMapProjects.map((p) => [p.id, p]));

    const seen = new Set<number>();
    const result: ConfigMapForProjectDto[] = [];
    for (const assoc of applicableAssocs) {
      if (seen.has(assoc.configMapProjectId)) continue;
      seen.add(assoc.configMapProjectId);
      result.push({
        associationId: assoc.id,
        configMapProjectId: assoc.configMapProjectId,
        configMapProjectName: projectMap.get(assoc.configMapProjectId)?.name ?? '',
        deviceTypeId: assoc.deviceTypeId,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Device config project auto-creation (called from discovery)
  // ---------------------------------------------------------------------------

  async ensureDeviceConfigProject({ deviceId, deviceTypeIds }: { deviceId: string; deviceTypeIds?: number[] }): Promise<number> {
    const projectName = `config:${deviceId}`;
    let project = await this.projectRepo.findOne({ where: { name: projectName } });

    if (!project) {
      this.logger.log(`Creating config project for device ${deviceId}`);
      project = await this.projectRepo.save(
        this.projectRepo.create({
          name: projectName,
          projectName: `Config – ${deviceId}`,
          projectType: ProjectType.CONFIG,
          description: `Auto-created config project for device ${deviceId}`,
        }),
      );

      await this.provisionDefaultConfigProject(project.id);
      await this.autoPublishInitialRevision(project.id, deviceId, deviceTypeIds);
    }

    return project.id;
  }

  async provisionDefaultConfigProject(projectId: number): Promise<void> {
    const draft = await this.getOrCreateDraftRevision(projectId);

    const existingCount = await this.groupRepo.count({ where: { revisionId: draft.id } });
    if (existingCount > 0) return;

    const defaultGroups = ['getapp_metadata', 'getapp_enrollment', 'getapp_config'];
    for (const name of defaultGroups) {
      await this.groupRepo.save(
        this.groupRepo.create({ revisionId: draft.id, name, isGlobal: false, gitFilePath: null, yamlContent: null, sensitiveKeys: [] }),
      );
    }
  }

  private async autoPublishInitialRevision(projectId: number, deviceId: string, knownDeviceTypeIds?: number[]): Promise<void> {
    const draft = await this.revisionRepo.findOne({ where: { projectId, status: ConfigRevisionStatus.DRAFT } });
    if (!draft) return;

    await this.populateDraftFromConfigMaps(draft.id, deviceId, knownDeviceTypeIds);

    const initialSemVer = '1.0.0';

    await this.revisionRepo.update(draft.id, {
      status: ConfigRevisionStatus.ACTIVE,
      appliedAt: new Date(),
      semVer: initialSemVer,
    });

    await this.revisionRepo.save(
      this.revisionRepo.create({ projectId, revisionNumber: draft.revisionNumber + 1, status: ConfigRevisionStatus.DRAFT }),
    );

    this.logger.log(`Auto-published initial revision for config project of device ${deviceId}`);

    this.assembleAndCacheDeviceConfig(deviceId, initialSemVer).catch((err) =>
      this.logger.error(
        `Failed to write initial config cache for device ${deviceId}: ${(err as Error)?.message}`,
      ),
    );
  }

  private async cascadeConfigMapRevisionToDevices(configMapProjectId: number): Promise<void> {
    const assocs = await this.assocRepo.find({ where: { configMapProjectId, configProjectId: IsNull() } });
    if (assocs.length === 0) return;

    const deviceIdSet = new Set<string>();

    for (const a of assocs) {
      if (a.deviceId) deviceIdSet.add(a.deviceId);
    }

    const typeIds = [...new Set(assocs.filter((a) => a.deviceTypeId != null).map((a) => a.deviceTypeId!))];
    if (typeIds.length > 0) {
      const deviceIds = await lastValueFrom(
        this.deviceClient.send<string[]>(DeviceTopics.GET_DEVICE_IDS_BY_TYPE_IDS, { typeIds }),
      ).catch(() => [] as string[]);
      for (const id of deviceIds) deviceIdSet.add(id);
    }

    if (deviceIdSet.size === 0) return;

    this.logger.log(`Cascading config map ${configMapProjectId} update to ${deviceIdSet.size} device config project(s)`);

    for (const deviceId of deviceIdSet) {
      const projectName = `config:${deviceId}`;
      const configProject = await this.projectRepo.findOne({ where: { name: projectName, projectType: ProjectType.CONFIG } });
      if (!configProject) continue;

      try {
        await this.refreshConfigProjectRevision(configProject.id, deviceId);
      } catch (err) {
        this.logger.error(`Failed to cascade config map update to ${projectName}: ${(err as Error)?.message}`);
      }
    }
  }

  private async refreshConfigProjectRevision(projectId: number, deviceId: string): Promise<void> {
    const draft = await this.getOrCreateDraftRevision(projectId);

    const previousActive = await this.revisionRepo.findOne({
      where: { projectId, status: ConfigRevisionStatus.ACTIVE },
      relations: { groups: true },
    });

    // Clear the draft entirely
    await this.groupRepo.delete({ revisionId: draft.id });

    // Re-populate from config maps
    await this.populateDraftFromConfigMaps(draft.id, deviceId);

    const newGroups = await this.groupRepo.find({ where: { revisionId: draft.id } });
    const newSemVer = this.computeNextSemVer(
      previousActive?.groups,
      newGroups,
      previousActive?.semVer ?? null,
    );

    await this.revisionRepo.update(
      { projectId, status: ConfigRevisionStatus.ACTIVE },
      { status: ConfigRevisionStatus.ARCHIVED },
    );

    await this.revisionRepo.update(draft.id, {
      status: ConfigRevisionStatus.ACTIVE,
      appliedAt: new Date(),
      semVer: newSemVer,
    });

    await this.revisionRepo.save(
      this.revisionRepo.create({ projectId, revisionNumber: draft.revisionNumber + 1, status: ConfigRevisionStatus.DRAFT }),
    );

    this.logger.log(
      `Re-published config project for device ${deviceId} due to config map update (v${newSemVer})`,
    );

    this.assembleAndCacheDeviceConfig(deviceId, newSemVer).catch((err) =>
      this.logger.error(
        `Failed to write config cache for device ${deviceId} @ ${newSemVer}: ${(err as Error)?.message}`,
      ),
    );
  }

  /**
   * Populates a draft revision's groups from all active config map revisions
   * that apply to the given device (global + device-type + direct associations).
   * Groups from multiple config maps are merged by name (later map wins on key conflict).
   */
  private async populateDraftFromConfigMaps(draftId: number, deviceId: string, knownDeviceTypeIds?: number[]): Promise<void> {
    const deviceTypeIds = knownDeviceTypeIds ?? await lastValueFrom(
      this.deviceClient.send<number[]>(DeviceTopics.GET_DEVICE_TYPE_IDS_FOR_DEVICE, deviceId),
    ).catch(() => [] as number[]);

    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull(), deviceId: IsNull(), configProjectId: IsNull() },
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
        { deviceId },
      ],
    });

    if (applicableAssocs.length === 0) return;

    const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
    const activeRevisions = await this.revisionRepo.find({
      where: { projectId: In(configMapProjectIds), status: ConfigRevisionStatus.ACTIVE },
      relations: { groups: true },
    });

    // Accumulate merged data per group name (later config map wins on key conflict).
    // Sensitive keys are unioned across all source groups for the same name.
    const groupMeta = new Map<string, { isGlobal: boolean; gitFilePath: string | null; sensitiveKeys: Set<string> }>();
    const groupData = new Map<string, Record<string, any>>();

    for (const rev of activeRevisions) {
      for (const cmGroup of rev.groups) {
        if (!groupData.has(cmGroup.name)) {
          groupMeta.set(cmGroup.name, {
            isGlobal: cmGroup.isGlobal,
            gitFilePath: cmGroup.gitFilePath,
            sensitiveKeys: new Set(cmGroup.sensitiveKeys ?? []),
          });
          groupData.set(cmGroup.name, {});
        } else {
          for (const k of (cmGroup.sensitiveKeys ?? [])) groupMeta.get(cmGroup.name)!.sensitiveKeys.add(k);
        }
        // Resolve vault refs to plaintext before merging so we can re-encrypt under the draft group id
        const resolved = await this.resolveGroupYaml(cmGroup);
        Object.assign(groupData.get(cmGroup.name)!, resolved);
      }
    }

    for (const [groupName, mergedObj] of groupData) {
      const meta = groupMeta.get(groupName)!;
      const sensitiveKeys = [...meta.sensitiveKeys];

      let draftGroup = await this.groupRepo.findOne({ where: { revisionId: draftId, name: groupName } });
      if (!draftGroup) {
        draftGroup = await this.groupRepo.save(
          this.groupRepo.create({
            revisionId: draftId,
            name: groupName,
            isGlobal: meta.isGlobal,
            gitFilePath: meta.gitFilePath,
            sensitiveKeys,
            yamlContent: null,
          }),
        );
      } else {
        await this.deleteGroupVaultSecrets(draftGroup);
        draftGroup.sensitiveKeys = sensitiveKeys;
        await this.groupRepo.save(draftGroup);
      }

      // Re-encrypt sensitive values under the draft group's vault paths
      if (sensitiveKeys.length > 0 && this.vaultService.isEnabled) {
        for (const keyPath of sensitiveKeys) {
          const value = getByPath(mergedObj, keyPath);
          if (value != null) {
            const strValue = typeof value === 'string' ? value : JSON.stringify(value);
            const vaultRef = await this.vaultService.storeSecret(
              CONFIG_VAULT_KEY_SECRET_NAME(draftGroup.id, keyPath),
              CONFIG_VAULT_FIELD,
              strValue,
              { deviceId, groupName, keyPath },
            );
            setByPath(mergedObj, keyPath, vaultRef);
          }
        }
      }

      draftGroup.yamlContent = Object.keys(mergedObj).length > 0 ? yaml.dump(mergedObj) : null;
      await this.groupRepo.save(draftGroup);
    }
  }

  // ---------------------------------------------------------------------------
  // Final device config assembly (for agent)
  // ---------------------------------------------------------------------------

  async getDeviceConfig(dto: GetDeviceConfigDto): Promise<DeviceConfigDto> {
    const { deviceId } = dto;

    const projectName = `config:${deviceId}`;
    const configProject = await this.projectRepo.findOne({
      where: { name: projectName, projectType: ProjectType.CONFIG },
    });

    const activeSemVer = configProject
      ? (
          await this.revisionRepo.findOne({
            where: { projectId: configProject.id, status: ConfigRevisionStatus.ACTIVE },
            select: ['semVer'],
          })
        )?.semVer ?? null
      : null;

    if (activeSemVer) {
      const cached = await this.cacheService.getByVersion(deviceId, activeSemVer);
      if (cached) return cached as DeviceConfigDto;
    }

    const assembled = await this.buildDeviceConfigPayload(deviceId);

    if (activeSemVer) {
      this.cacheService.setByVersion(deviceId, activeSemVer, assembled as any).catch((err: any) =>
        this.logger.warn(`Config cache write failed for device ${deviceId}: ${err.message}`),
      );
    }

    return assembled;
  }

  async getDeviceConfigByVersion(dto: GetDeviceConfigByVersionDto): Promise<DeviceConfigDto> {
    const cached = await this.cacheService.getByVersion(dto.deviceId, dto.semver);
    if (cached) return cached as DeviceConfigDto;

    const projectName = `config:${dto.deviceId}`;
    const configProject = await this.projectRepo.findOne({
      where: { name: projectName, projectType: ProjectType.CONFIG },
    });
    if (!configProject) {
      throw new NotFoundException(`No config project found for device '${dto.deviceId}'`);
    }

    const revision = await this.revisionRepo.findOne({
      where: { projectId: configProject.id, semVer: dto.semver },
      relations: { groups: true },
    });
    if (!revision) {
      throw new NotFoundException(
        `No revision with semver '${dto.semver}' found for device '${dto.deviceId}'`,
      );
    }

    const globalsData = await this.collectGlobals(revision.groups);
    const groups: Record<string, Record<string, any>> = {};

    for (const group of revision.groups) {
      if (group.isGlobal) continue;
      const groupData = await this.resolveGroupYaml(group, { ...globalsData });
      for (const key of Object.keys(groupData)) {
        if (groupData[key] == null) delete groupData[key];
      }
      groups[group.name] = groupData;
    }

    const payload: DeviceConfigDto = {
      deviceId: dto.deviceId,
      configRevisionId: revision.id,
      semVer: revision.semVer,
      groups,
      computedAt: revision.appliedAt?.toISOString() ?? revision.createdAt.toISOString(),
    };

    this.cacheService.setByVersion(dto.deviceId, dto.semver, payload as any).catch((err: any) =>
      this.logger.warn(
        `Config cache write (reconstruction) failed for device ${dto.deviceId} @ ${dto.semver}: ${err.message}`,
      ),
    );

    return payload;
  }

  /**
   * Syncs config groups for a CONFIG project from gitops YAML content.
   * Entries from `yamlContent` are serialised to a YAML string and stored on
   * the group in the draft revision.
   */
  async syncGroupFromGitYaml(
    projectId: number,
    groupName: string,
    isGlobal: boolean,
    gitFilePath: string,
    yamlContent: Record<string, string>,
  ): Promise<void> {
    const draft = await this.getOrCreateDraftRevision(projectId);

    let group = await this.groupRepo.findOne({ where: { revisionId: draft.id, name: groupName } });
    if (!group) {
      group = this.groupRepo.create({ revisionId: draft.id, name: groupName, isGlobal, gitFilePath });
    } else {
      group.isGlobal = isGlobal;
      group.gitFilePath = gitFilePath;
    }

    const parsed: Record<string, any> = { ...yamlContent };
    const sensitiveKeys = group.sensitiveKeys ?? [];

    if (sensitiveKeys.length > 0 && this.vaultService.isEnabled) {
      if (!group.id) {
        const saved = await this.groupRepo.save(group);
        group.id = saved.id;
      }
      for (const keyPath of sensitiveKeys) {
        const value = getByPath(parsed, keyPath);
        if (value != null && !this.vaultService.isVaultRef(String(value))) {
          const vaultRef = await this.vaultService.storeSecret(
            CONFIG_VAULT_KEY_SECRET_NAME(group.id, keyPath),
            CONFIG_VAULT_FIELD,
            String(value),
            { groupName, keyPath },
          );
          setByPath(parsed, keyPath, vaultRef);
        }
      }
    }

    group.yamlContent = Object.keys(parsed).length > 0 ? yaml.dump(parsed) : null;
    await this.groupRepo.save(group);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Assembles the final device config payload by merging CONFIG_MAP baseline
   * groups with device CONFIG project overrides. Vault refs in sensitive groups
   * are always resolved so the payload is ready for consumption.
   */
  private async buildDeviceConfigPayload(deviceId: string): Promise<DeviceConfigDto> {
    const projectName = `config:${deviceId}`;
    const configProject = await this.projectRepo.findOne({
      where: { name: projectName, projectType: ProjectType.CONFIG },
    });

    const deviceTypeIds = await lastValueFrom(
      this.deviceClient.send<number[]>(DeviceTopics.GET_DEVICE_TYPE_IDS_FOR_DEVICE, deviceId),
    ).catch(() => [] as number[]);

    // --- ConfigMap groups (lowest priority) ---
    const configMapGroups: Record<string, Record<string, any>> = {};
    const globalConfigMapEntries: Record<string, any> = {};

    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull(), deviceId: IsNull(), configProjectId: IsNull() },
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
        { deviceId },
      ],
    });

    if (applicableAssocs.length > 0) {
      const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
      const activeRevisions = await this.revisionRepo.find({
        where: { projectId: In(configMapProjectIds), status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: true },
      });

      for (const rev of activeRevisions) {
        const globalsEntries = await this.collectGlobals(rev.groups);
        for (const group of rev.groups) {
          if (group.isGlobal) continue;
          const groupData = await this.resolveGroupYaml(group);
          configMapGroups[group.name] = { ...(configMapGroups[group.name] ?? {}), ...groupData };
        }
        Object.assign(globalConfigMapEntries, globalsEntries);
      }
    }

    // --- Device config project groups (higher priority) ---
    const deviceGroups: Record<string, Record<string, any>> = {};
    const globalDeviceEntries: Record<string, any> = {};
    let configRevisionId: number | null = null;
    let activeSemVer: string | null = null;

    if (configProject) {
      const activeRevision = await this.revisionRepo.findOne({
        where: { projectId: configProject.id, status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: true },
      });

      if (activeRevision) {
        configRevisionId = activeRevision.id;
        activeSemVer = activeRevision.semVer;
        const globalsEntries = await this.collectGlobals(activeRevision.groups);
        Object.assign(globalDeviceEntries, globalsEntries);

        for (const group of activeRevision.groups) {
          if (group.isGlobal) continue;
          const groupData = await this.resolveGroupYaml(group);
          deviceGroups[group.name] = groupData;
        }
      }
    }

    // --- Merge: configMap baseline + device overrides ---
    const mergedGroups: Record<string, Record<string, any>> = {};
    const allGroupNames = new Set([...Object.keys(configMapGroups), ...Object.keys(deviceGroups)]);
    const combinedGlobals = { ...globalConfigMapEntries, ...globalDeviceEntries };

    for (const name of allGroupNames) {
      const merged: Record<string, any> = {
        ...combinedGlobals,
        ...(configMapGroups[name] ?? {}),
        ...(deviceGroups[name] ?? {}),
      };

      for (const key of Object.keys(merged)) {
        if (merged[key] == null) delete merged[key];
      }

      mergedGroups[name] = merged;
    }

    return {
      deviceId,
      configRevisionId,
      semVer: activeSemVer,
      groups: mergedGroups,
      computedAt: new Date().toISOString(),
    };
  }

  private async assembleAndCacheDeviceConfig(deviceId: string, semVer: string): Promise<void> {
    const payload = await this.buildDeviceConfigPayload(deviceId);
    await this.cacheService.setByVersion(deviceId, semVer, payload as any);
  }

  /**
   * Resolves a group's YAML content: vault refs at sensitive key paths are
   * replaced with their plaintext values.  Returns a plain object merged over
   * `globals` (default empty).  Used when building the final device config.
   */
  private async resolveGroupYaml(
    group: ConfigGroupEntity,
    globals: Record<string, any> = {},
  ): Promise<Record<string, any>> {
    const parsed = this.parseYaml(group.yamlContent);

    if (this.vaultService.isEnabled && group.sensitiveKeys?.length) {
      for (const keyPath of group.sensitiveKeys) {
        const value = getByPath(parsed, keyPath);
        if (value != null && this.vaultService.isVaultRef(String(value))) {
          try {
            const resolved = await this.vaultService.resolveSecret(String(value));
            setByPath(parsed, keyPath, resolved ?? null);
          } catch {
            setByPath(parsed, keyPath, null);
          }
        }
      }
    }

    return { ...globals, ...parsed };
  }

  /**
   * Copies a source group into a new revision, re-encrypting every sensitive
   * key under the new group's Vault secret path so each group fully owns its
   * secrets and deletion of the source group doesn't break the copy.
   */
  private async cloneGroupToRevision(source: ConfigGroupEntity, targetRevisionId: number): Promise<ConfigGroupEntity> {
    const newGroup = await this.groupRepo.save(
      this.groupRepo.create({
        revisionId: targetRevisionId,
        name: source.name,
        isGlobal: source.isGlobal,
        gitFilePath: source.gitFilePath,
        sensitiveKeys: source.sensitiveKeys ?? [],
        yamlContent: null, // filled in below
      }),
    );

    if (source.yamlContent) {
      const parsed = this.parseYaml(source.yamlContent);

      if ((source.sensitiveKeys ?? []).length > 0 && this.vaultService.isEnabled) {
        for (const keyPath of source.sensitiveKeys) {
          const value = getByPath(parsed, keyPath);
          if (value != null && this.vaultService.isVaultRef(String(value))) {
            try {
              const plaintext = await this.vaultService.resolveSecret(String(value));
              if (plaintext != null) {
                const newRef = await this.vaultService.storeSecret(
                  CONFIG_VAULT_KEY_SECRET_NAME(newGroup.id, keyPath),
                  CONFIG_VAULT_FIELD,
                  plaintext,
                  {},
                );
                setByPath(parsed, keyPath, newRef);
              }
            } catch {
              // Keep the old vault ref rather than losing the value
            }
          }
        }
      }

      newGroup.yamlContent = Object.keys(parsed).length > 0 ? yaml.dump(parsed) : null;
      await this.groupRepo.save(newGroup);
    }

    return newGroup;
  }

  /**
   * Computes the next semantic version for a config revision based on the diff
   * between the previous ACTIVE revision's groups and the incoming draft groups.
   *
   * Comparison is done on top-level YAML keys:
   *   - New group added           → major bump
   *   - Group removed             → major bump
   *   - Top-level key deleted     → major bump
   *   - Top-level key added       → minor bump
   *   - Top-level value updated   → minor bump
   *   - No structural change      → patch bump
   */
  private computeNextSemVer(
    prevGroups: ConfigGroupEntity[] | undefined | null,
    draftGroups: ConfigGroupEntity[],
    prevSemVer: string | null,
  ): string {
    if (!prevGroups || prevGroups.length === 0) return '1.0.0';

    let major = 0;
    let minor = 0;
    let patch = 0;
    if (prevSemVer) {
      const parts = prevSemVer.split('.').map(Number);
      [major, minor, patch] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    }

    const prevMap = new Map<string, Record<string, any>>();
    for (const g of prevGroups) prevMap.set(g.name, this.parseYaml(g.yamlContent));

    const draftMap = new Map<string, Record<string, any>>();
    for (const g of draftGroups) draftMap.set(g.name, this.parseYaml(g.yamlContent));

    let hasMajorChange = false;
    let hasMinorChange = false;

    for (const [groupName, draftParsed] of draftMap) {
      const prevParsed = prevMap.get(groupName);
      if (!prevParsed) {
        hasMajorChange = true;
        continue;
      }
      const prevKeys = new Set(Object.keys(prevParsed));
      const draftKeys = new Set(Object.keys(draftParsed));

      for (const key of draftKeys) {
        if (!prevKeys.has(key)) {
          hasMinorChange = true;
        } else if (JSON.stringify(prevParsed[key]) !== JSON.stringify(draftParsed[key])) {
          hasMinorChange = true;
        }
      }
      for (const key of prevKeys) {
        if (!draftKeys.has(key)) hasMajorChange = true;
      }
    }

    for (const groupName of prevMap.keys()) {
      if (!draftMap.has(groupName)) hasMajorChange = true;
    }

    if (hasMajorChange) return `${major + 1}.0.0`;
    if (hasMinorChange) return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }

  private async collectGlobals(groups: ConfigGroupEntity[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const group of groups) {
      if (!group.isGlobal) continue;
      const resolved = await this.resolveGroupYaml(group);
      Object.assign(result, resolved);
    }
    return result;
  }

  private mapGroupToDto(group: ConfigGroupEntity): ConfigGroupDto {
    const sensitiveKeys = group.sensitiveKeys ?? [];
    let maskedYaml = group.yamlContent;

    if (sensitiveKeys.length > 0 && group.yamlContent) {
      const parsed = this.parseYaml(group.yamlContent);
      for (const keyPath of sensitiveKeys) {
        if (getByPath(parsed, keyPath) != null) {
          setByPath(parsed, keyPath, '***');
        }
      }
      maskedYaml = yaml.dump(parsed);
    }

    return {
      id: group.id,
      name: group.name,
      isGlobal: group.isGlobal,
      gitFilePath: group.gitFilePath,
      sensitiveKeys,
      yamlContent: maskedYaml,
    };
  }

  private mapRevisionToDto(revision: ConfigRevisionEntity, includeGroups: boolean): ConfigRevisionDto {
    return {
      id: revision.id,
      projectId: revision.projectId,
      revisionNumber: revision.revisionNumber,
      status: revision.status,
      appliedBy: revision.appliedBy,
      appliedAt: revision.appliedAt,
      semVer: revision.semVer ?? null,
      createdAt: revision.createdAt,
      ...(includeGroups && revision.groups ? { groups: revision.groups.map((g) => this.mapGroupToDto(g)) } : {}),
    };
  }
}
