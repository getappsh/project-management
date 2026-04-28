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
import {
  ConfigEntryEntity,
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
  ConfigEntryDto,
  ConfigGroupDto,
  ConfigGroupValuesMap,
  ConfigMapAssociationDto,
  ConfigMapForProjectDto,
  ConfigRevisionDto,
  DeleteConfigEntryDto,
  DeleteConfigGroupDto,
  DeviceConfigDto,
  GetConfigRevisionByIdDto,
  GetConfigRevisionsDto,
  GetDeviceConfigByVersionDto,
  GetDeviceConfigDto,
  RemoveConfigMapAssociationDto,
  UpsertConfigEntryDto,
  UpsertConfigGroupDto,
} from '@app/common/dto/project-management';
import { VaultService } from '@app/common/vault';
import { ConfigCacheService } from './config-cache.service';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { DeviceTopics, DevicesHierarchyTopics } from '@app/common/microservice-client/topics';
import { lastValueFrom } from 'rxjs';

const CONFIG_VAULT_SECRET_NAME = (entryId: number) => `config-entry-${entryId}`;
const CONFIG_VAULT_FIELD = 'config_value' as const;

@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ConfigRevisionEntity) private readonly revisionRepo: Repository<ConfigRevisionEntity>,
    @InjectRepository(ConfigGroupEntity) private readonly groupRepo: Repository<ConfigGroupEntity>,
    @InjectRepository(ConfigEntryEntity) private readonly entryRepo: Repository<ConfigEntryEntity>,
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
   * Returns the current DRAFT revision for a project, creating one if none exists.
   * New revisions start at revisionNumber = 1 or max(existing) + 1.
   */
  async getOrCreateDraftRevision(projectId: number): Promise<ConfigRevisionEntity> {
    const existing = await this.revisionRepo.findOne({
      where: { projectId, status: ConfigRevisionStatus.DRAFT },
      relations: { groups: { entries: true } },
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
  // Group & Entry CRUD (operates on the current DRAFT revision)
  // ---------------------------------------------------------------------------

  async upsertGroup(dto: UpsertConfigGroupDto): Promise<ConfigGroupDto> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);

    const draft = await this.getOrCreateDraftRevision(project.id);

    let group = await this.groupRepo.findOne({
      where: { revisionId: draft.id, name: dto.name },
      relations: { entries: true },
    });

    if (!group) {
      group = this.groupRepo.create({ revisionId: draft.id, name: dto.name });
    }

    group.isGlobal = dto.isGlobal ?? group.isGlobal ?? false;
    group.gitFilePath = dto.gitFilePath ?? group.gitFilePath ?? null;

    if (dto.entries && dto.entries.length > 0) {
      // Replace all entries
      if (group.id) await this.entryRepo.delete({ groupId: group.id });
      group.entries = dto.entries.map((e) =>
        this.entryRepo.create({ key: e.key, value: e.value ?? null, isSensitive: e.isSensitive ?? false }),
      );
    }

    await this.groupRepo.save(group);
    return this.mapGroupToDto(group);
  }

  async deleteGroup(dto: DeleteConfigGroupDto): Promise<{ success: boolean }> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);
    const draft = await this.getOrCreateDraftRevision(project.id);
    const group = await this.groupRepo.findOne({ where: { revisionId: draft.id, name: dto.groupName } });
    if (!group) throw new NotFoundException(`Group '${dto.groupName}' not found in draft revision`);
    await this.groupRepo.remove(group);
    return { success: true };
  }

  async upsertEntry(dto: UpsertConfigEntryDto): Promise<ConfigEntryDto> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);
    const draft = await this.getOrCreateDraftRevision(project.id);

    let group = await this.groupRepo.findOne({ where: { revisionId: draft.id, name: dto.groupName } });
    if (!group) {
      group = await this.groupRepo.save(this.groupRepo.create({ revisionId: draft.id, name: dto.groupName }));
    }

    let entry = await this.entryRepo.findOne({ where: { groupId: group.id, key: dto.key } });
    if (!entry) {
      entry = this.entryRepo.create({ groupId: group.id, key: dto.key });
    }

    const isSensitive = dto.isSensitive ?? entry.isSensitive ?? false;
    entry.isSensitive = isSensitive;

    if (dto.value !== undefined) {
      if (isSensitive && this.vaultService.isEnabled) {
        // Save plaintext to Vault; store the reference in the DB column
        const savedEntry = await this.entryRepo.save(entry);
        const vaultRef = await this.vaultService.storeSecret(
          CONFIG_VAULT_SECRET_NAME(savedEntry.id),
          CONFIG_VAULT_FIELD,
          dto.value,
          { projectId: String(project.id), groupName: dto.groupName, key: dto.key },
        );
        entry.value = vaultRef;
        entry.id = savedEntry.id;
      } else {
        entry.value = dto.value;
      }
    }

    const saved = await this.entryRepo.save(entry);
    return this.mapEntryToDto(saved, false /* never expose vault ref in response */);
  }

  async deleteEntry(dto: DeleteConfigEntryDto): Promise<{ success: boolean }> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);
    const draft = await this.getOrCreateDraftRevision(project.id);
    const group = await this.groupRepo.findOne({ where: { revisionId: draft.id, name: dto.groupName } });
    if (!group) throw new NotFoundException(`Group '${dto.groupName}' not found`);
    const entry = await this.entryRepo.findOne({ where: { groupId: group.id, key: dto.key } });
    if (!entry) throw new NotFoundException(`Entry '${dto.key}' not found in group '${dto.groupName}'`);

    // Remove from Vault if stored there
    if (entry.isSensitive && this.vaultService.isEnabled && this.vaultService.isVaultRef(entry.value)) {
      await this.vaultService.deleteSecret(CONFIG_VAULT_SECRET_NAME(entry.id), CONFIG_VAULT_FIELD);
    }

    await this.entryRepo.remove(entry);
    return { success: true };
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
      relations: { groups: { entries: true } },
    });
    if (!draft) throw new NotFoundException(`No draft revision found for project '${dto.projectIdentifier}'`);

    // Capture the current ACTIVE revision (and its semver) before archiving it
    const previousActive = await this.revisionRepo.findOne({
      where: { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
      relations: { groups: { entries: true } },
    });

    // Archive the current active revision
    await this.revisionRepo.update(
      { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
      { status: ConfigRevisionStatus.ARCHIVED },
    );

    // Compute the new semantic version by diffing draft vs previous active
    draft.semVer = this.computeNextSemVer(
      previousActive?.groups,
      draft.groups ?? [],
      previousActive?.semVer ?? null,
    );

    // Promote the draft to active
    draft.status = ConfigRevisionStatus.ACTIVE;
    draft.appliedBy = dto.appliedBy ?? null;
    draft.appliedAt = new Date();
    await this.revisionRepo.save(draft);

    this.logger.log(
      `Applied revision ${draft.id} (rev#${draft.revisionNumber}, v${draft.semVer}) for project ${project.id}`,
    );

    // Eagerly write the assembled config to the versioned cache for CONFIG projects
    if (project.projectType === ProjectType.CONFIG && project.name.startsWith('config:')) {
      const deviceId = project.name.slice('config:'.length);
      this.assembleAndCacheDeviceConfig(deviceId, draft.semVer).catch((err) =>
        this.logger.error(
          `Failed to write config cache for device ${deviceId} @ ${draft.semVer}: ${(err as Error)?.message}`,
        ),
      );
    }

    // Cascade: if a config map was applied, re-publish all associated device config projects
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
      relations: dto.includeGroups ? { groups: { entries: true } } : undefined,
    });
    return revisions.map((r) => this.mapRevisionToDto(r, dto.includeGroups ?? false));
  }

  async getRevisionById(dto: GetConfigRevisionByIdDto): Promise<ConfigRevisionDto> {
    const revision = await this.revisionRepo.findOne({
      where: { id: dto.revisionId },
      relations: dto.includeGroups ? { groups: { entries: true } } : undefined,
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

    // Copy groups and entries from the latest published revision (ACTIVE → ARCHIVED fallback)
    const source =
      (await this.revisionRepo.findOne({
        where: { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: { entries: true } },
      })) ??
      (await this.revisionRepo.findOne({
        where: { projectId: project.id, status: ConfigRevisionStatus.ARCHIVED },
        order: { revisionNumber: 'DESC' },
        relations: { groups: { entries: true } },
      }));

    if (source?.groups?.length) {
      await this.groupRepo.save(
        source.groups.map((g) =>
          this.groupRepo.create({
            revisionId: draft.id,
            name: g.name,
            isGlobal: g.isGlobal,
            gitFilePath: g.gitFilePath,
            entries: g.entries.map((e) =>
              this.entryRepo.create({ key: e.key, value: e.value, isSensitive: e.isSensitive }),
            ),
          }),
        ),
      );
      draft.groups = await this.groupRepo.find({ where: { revisionId: draft.id }, relations: { entries: true } });
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
      relations: { groups: { entries: true } },
    });
    if (!draft) throw new NotFoundException(`No draft revision found for project '${dto.projectIdentifier}'`);

    // Clean up Vault secrets for sensitive entries before deleting
    if (this.vaultService.isEnabled) {
      for (const group of draft.groups ?? []) {
        for (const entry of group.entries ?? []) {
          if (entry.isSensitive && this.vaultService.isVaultRef(entry.value)) {
            await this.vaultService.deleteSecret(CONFIG_VAULT_SECRET_NAME(entry.id), CONFIG_VAULT_FIELD).catch((err) =>
              this.logger.warn(`Failed to delete Vault secret for entry ${entry.id}: ${(err as Error)?.message}`),
            );
          }
        }
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

    // --- Device-type association ---
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

    // --- Device-ID associations ---
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
    // Only return user-created associations (configProjectId rows are internal denormalization)
    const assocs = await this.assocRepo.find({ where: { configMapProjectId: project.id, configProjectId: IsNull() } });
    const result = await assocs.map((a) => ({ id: a.id, configMapProjectId: a.configMapProjectId, deviceTypeId: a.deviceTypeId, deviceId: a.deviceId ?? null, configProjectId: null }));
    return result;
  }

  /**
   * Returns all CONFIG_MAP projects whose associations cover a given CONFIG project.
   * A CONFIG project is device-specific (name = `config:{deviceId}`).
   * We find the device's type IDs and return all CONFIG_MAP associations that match
   * those device types or are global (deviceTypeId IS NULL).
   */
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

    // Query: global OR device-type match OR device-id match
    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull(), deviceId: IsNull(), configProjectId: IsNull() }, // global
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
        ...(deviceId ? [{ deviceId }] : []),
      ],
    });

    if (applicableAssocs.length === 0) return [];

    const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
    const configMapProjects = await this.projectRepo.find({ where: { id: In(configMapProjectIds) } });
    const projectMap = new Map(configMapProjects.map((p) => [p.id, p]));

    // Deduplicate by configMapProjectId (direct link + device-type link both match same project)
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

  /**
   * Ensures a CONFIG project exists for `deviceId`.
   * Attaches any CONFIG_MAP projects whose associations match the device's device types.
   * Returns the project id.
   */
  async ensureDeviceConfigProject({ deviceId, deviceTypeIds }: { deviceId: string; deviceTypeIds?: number[] }): Promise<number> {
    // Config projects are named by device id convention
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

      // Create the first draft revision with the 3 default groups
      await this.provisionDefaultConfigProject(project.id);
      // Pre-populate from associated config maps and publish the initial revision
      await this.autoPublishInitialRevision(project.id, deviceId, deviceTypeIds);
    }

    return project.id;
  }

  /**
   * Creates a draft revision with the 3 standard empty groups for a newly
   * created CONFIG project. Idempotent – if a draft already exists the call
   * is a no-op; groups are only added when the revision has no groups yet.
   */
  async provisionDefaultConfigProject(projectId: number): Promise<void> {
    const draft = await this.getOrCreateDraftRevision(projectId);

    // Skip if groups were already created
    const existingCount = await this.groupRepo.count({ where: { revisionId: draft.id } });
    if (existingCount > 0) return;

    const defaultGroups = ['getapp_metadata', 'getapp_enrollment', 'getapp_config'];
    for (const name of defaultGroups) {
      await this.groupRepo.save(
        this.groupRepo.create({ revisionId: draft.id, name, isGlobal: false, gitFilePath: null }),
      );
    }
  }

  /**
   * Pre-populates the draft revision with entries from all applicable config maps
   * (global + device-type + device-id associations), then promotes it to ACTIVE
   * and creates a fresh DRAFT for subsequent edits.
   * Called once at project creation time.
   */
  private async autoPublishInitialRevision(projectId: number, deviceId: string, knownDeviceTypeIds?: number[]): Promise<void> {
    const draft = await this.revisionRepo.findOne({ where: { projectId, status: ConfigRevisionStatus.DRAFT } });
    if (!draft) return;

    await this.populateDraftFromConfigMaps(draft.id, deviceId, knownDeviceTypeIds);

    // Initial revision always starts at 1.0.0
    const initialSemVer = '1.0.0';

    // Promote draft → active (use update to avoid cascade-clearing the groups relation)
    await this.revisionRepo.update(draft.id, {
      status: ConfigRevisionStatus.ACTIVE,
      appliedAt: new Date(),
      semVer: initialSemVer,
    });

    // Create fresh empty draft for subsequent edits
    await this.revisionRepo.save(
      this.revisionRepo.create({ projectId, revisionNumber: draft.revisionNumber + 1, status: ConfigRevisionStatus.DRAFT }),
    );

    this.logger.log(`Auto-published initial revision for config project of device ${deviceId}`);

    // Write the assembled config to the versioned cache (fire-and-forget)
    this.assembleAndCacheDeviceConfig(deviceId, initialSemVer).catch((err) =>
      this.logger.error(
        `Failed to write initial config cache for device ${deviceId}: ${(err as Error)?.message}`,
      ),
    );
  }

  /**
   * Finds all device config projects associated with a config map project
   * (via direct deviceId or deviceType associations) and re-publishes each one.
   * Runs fire-and-forget from applyRevision.
   */
  private async cascadeConfigMapRevisionToDevices(configMapProjectId: number): Promise<void> {
    const assocs = await this.assocRepo.find({ where: { configMapProjectId, configProjectId: IsNull() } });
    if (assocs.length === 0) return;

    const deviceIdSet = new Set<string>();

    // Direct device associations
    for (const a of assocs) {
      if (a.deviceId) deviceIdSet.add(a.deviceId);
    }

    // Device-type associations → expand to all devices of those types
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
      if (!configProject) continue; // device hasn't enrolled yet — will get it on first ensureDeviceConfigProject

      try {
        await this.refreshConfigProjectRevision(configProject.id, deviceId);
      } catch (err) {
        this.logger.error(`Failed to cascade config map update to ${projectName}: ${(err as Error)?.message}`);
      }
    }
  }

  /**
   * Re-publishes a config project by resetting its current draft to a fresh snapshot
   * from all applicable config maps, then archiving the current active revision and
   * promoting the draft to active. Creates a fresh empty draft for subsequent edits.
   */
  private async refreshConfigProjectRevision(projectId: number, deviceId: string): Promise<void> {
    const draft = await this.getOrCreateDraftRevision(projectId);

    // Capture the current active revision (and its semver) before clearing the draft
    const previousActive = await this.revisionRepo.findOne({
      where: { projectId, status: ConfigRevisionStatus.ACTIVE },
      relations: { groups: { entries: true } },
    });

    // Clear the draft entirely so we start from a clean slate
    const existingGroups = await this.groupRepo.find({ where: { revisionId: draft.id } });
    for (const g of existingGroups) {
      await this.entryRepo.delete({ groupId: g.id });
    }
    if (existingGroups.length > 0) {
      await this.groupRepo.delete({ revisionId: draft.id });
    }

    // Re-populate from all applicable config maps
    await this.populateDraftFromConfigMaps(draft.id, deviceId);

    // Load the freshly populated draft groups to compute the semver diff
    const newGroups = await this.groupRepo.find({ where: { revisionId: draft.id }, relations: { entries: true } });
    const newSemVer = this.computeNextSemVer(
      previousActive?.groups,
      newGroups,
      previousActive?.semVer ?? null,
    );

    // Archive the current active revision
    await this.revisionRepo.update(
      { projectId, status: ConfigRevisionStatus.ACTIVE },
      { status: ConfigRevisionStatus.ARCHIVED },
    );

    // Promote draft → active
    await this.revisionRepo.update(draft.id, {
      status: ConfigRevisionStatus.ACTIVE,
      appliedAt: new Date(),
      semVer: newSemVer,
    });

    // Create fresh empty draft for subsequent edits
    await this.revisionRepo.save(
      this.revisionRepo.create({ projectId, revisionNumber: draft.revisionNumber + 1, status: ConfigRevisionStatus.DRAFT }),
    );

    this.logger.log(
      `Re-published config project for device ${deviceId} due to config map update (v${newSemVer})`,
    );

    // Write the assembled config to the versioned cache (fire-and-forget)
    this.assembleAndCacheDeviceConfig(deviceId, newSemVer).catch((err) =>
      this.logger.error(
        `Failed to write config cache for device ${deviceId} @ ${newSemVer}: ${(err as Error)?.message}`,
      ),
    );
  }

  /**
   * Populates a draft revision's groups and entries from all config map active revisions
   * that apply to the given device (global + device-type + direct device associations).
   * If a group already exists in the draft its entries are replaced; otherwise it is created.
   */
  private async populateDraftFromConfigMaps(draftId: number, deviceId: string, knownDeviceTypeIds?: number[]): Promise<void> {
    const deviceTypeIds = knownDeviceTypeIds ?? await lastValueFrom(
      this.deviceClient.send<number[]>(DeviceTopics.GET_DEVICE_TYPE_IDS_FOR_DEVICE, deviceId),
    ).catch(() => [] as number[]);

    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull(), deviceId: IsNull(), configProjectId: IsNull() }, // global
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
        { deviceId }, // direct device association
      ],
    });

    if (applicableAssocs.length === 0) return;

    const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
    const activeRevisions = await this.revisionRepo.find({
      where: { projectId: In(configMapProjectIds), status: ConfigRevisionStatus.ACTIVE },
      relations: { groups: { entries: true } },
    });

    // Accumulate merged entries per group (later config map wins on key conflict)
    const groupMeta = new Map<string, { isGlobal: boolean; gitFilePath: string | null }>();
    const groupEntries = new Map<string, Map<string, { value: string | null; isSensitive: boolean }>>();

    for (const rev of activeRevisions) {
      for (const cmGroup of rev.groups) {
        if (!groupEntries.has(cmGroup.name)) {
          groupMeta.set(cmGroup.name, { isGlobal: cmGroup.isGlobal, gitFilePath: cmGroup.gitFilePath });
          groupEntries.set(cmGroup.name, new Map());
        }
        for (const e of cmGroup.entries ?? []) {
          groupEntries.get(cmGroup.name)!.set(e.key, { value: e.value, isSensitive: e.isSensitive });
        }
      }
    }

    for (const [groupName, entries] of groupEntries) {
      let draftGroup = await this.groupRepo.findOne({ where: { revisionId: draftId, name: groupName } });
      if (!draftGroup) {
        const meta = groupMeta.get(groupName)!;
        draftGroup = await this.groupRepo.save(
          this.groupRepo.create({ revisionId: draftId, name: groupName, isGlobal: meta.isGlobal, gitFilePath: meta.gitFilePath }),
        );
      } else {
        await this.entryRepo.delete({ groupId: draftGroup.id });
      }
      if (entries.size > 0) {
        const toSave = [...entries.entries()].map(([key, { value, isSensitive }]) =>
          this.entryRepo.create({ groupId: draftGroup!.id, key, value, isSensitive }),
        );
        await this.entryRepo.save(toSave);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Final device config assembly (for agent)
  // ---------------------------------------------------------------------------

  async getDeviceConfig(dto: GetDeviceConfigDto): Promise<DeviceConfigDto> {
    const resolveSecrets = dto.resolveSecrets !== false;
    const { deviceId } = dto;

    // Find the ACTIVE revision for this device's config project to get its semVer
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

    // Try versioned cache first
    if (activeSemVer) {
      const cached = await this.cacheService.getByVersion(deviceId, activeSemVer);
      if (cached) {
        const cachedPayload = cached as DeviceConfigDto;
        if (resolveSecrets) {
          const enrichedGroups = await this.resolveVaultRefsInGroups(cachedPayload.groups);
          return { ...cachedPayload, groups: enrichedGroups };
        }
        return cachedPayload;
      }
    }

    // Cache miss – assemble the config fresh
    const assembled = await this.buildDeviceConfigPayload(deviceId);

    // Persist to versioned cache if we have a semver (fire-and-forget on errors)
    if (activeSemVer) {
      this.cacheService.setByVersion(deviceId, activeSemVer, assembled as any).catch((err: any) =>
        this.logger.warn(`Config cache write failed for device ${deviceId}: ${err.message}`),
      );
    }

    if (resolveSecrets) {
      const enrichedGroups = await this.resolveVaultRefsInGroups(assembled.groups);
      return { ...assembled, groups: enrichedGroups };
    }

    return assembled;
  }

  /**
   * Returns the assembled device config for a specific previously-published
   * semver. Prefers the versioned S3 cache; falls back to reconstructing from
   * the stored revision groups when the cache entry is absent.
   */
  async getDeviceConfigByVersion(dto: GetDeviceConfigByVersionDto): Promise<DeviceConfigDto> {
    const resolveSecrets = dto.resolveSecrets !== false;

    // 1. Try versioned cache
    const cached = await this.cacheService.getByVersion(dto.deviceId, dto.semver);
    if (cached) {
      const cachedPayload = cached as DeviceConfigDto;
      if (resolveSecrets) {
        const enrichedGroups = await this.resolveVaultRefsInGroups(cachedPayload.groups);
        return { ...cachedPayload, groups: enrichedGroups };
      }
      return cachedPayload;
    }

    // 2. Cache miss – reconstruct from the stored revision
    const projectName = `config:${dto.deviceId}`;
    const configProject = await this.projectRepo.findOne({
      where: { name: projectName, projectType: ProjectType.CONFIG },
    });
    if (!configProject) {
      throw new NotFoundException(`No config project found for device '${dto.deviceId}'`);
    }

    const revision = await this.revisionRepo.findOne({
      where: { projectId: configProject.id, semVer: dto.semver },
      relations: { groups: { entries: true } },
    });
    if (!revision) {
      throw new NotFoundException(
        `No revision with semver '${dto.semver}' found for device '${dto.deviceId}'`,
      );
    }

    // Reconstruct the assembled config from the stored snapshot groups
    const globalsEntries = this.collectGlobals(revision.groups);
    const groups: Record<string, Record<string, string | null>> = {};

    for (const group of revision.groups) {
      if (group.isGlobal) continue;
      const groupEntries = await this.resolveGroupEntries(group.entries, { ...globalsEntries }, false);
      // Remove tombstones
      for (const key of Object.keys(groupEntries)) {
        const val = groupEntries[key];
        if (val == null || val === 'null' || val === 'undefined') {
          delete groupEntries[key];
        }
      }
      groups[group.name] = groupEntries;
    }

    const payload: DeviceConfigDto = {
      deviceId: dto.deviceId,
      configRevisionId: revision.id,
      semVer: revision.semVer,
      groups,
      computedAt: revision.appliedAt?.toISOString() ?? revision.createdAt.toISOString(),
    };

    // Write the reconstructed payload back to cache for future requests
    this.cacheService.setByVersion(dto.deviceId, dto.semver, payload as any).catch((err: any) =>
      this.logger.warn(
        `Config cache write (reconstruction) failed for device ${dto.deviceId} @ ${dto.semver}: ${err.message}`,
      ),
    );

    if (resolveSecrets) {
      const enrichedGroups = await this.resolveVaultRefsInGroups(payload.groups);
      return { ...payload, groups: enrichedGroups };
    }

    return payload;
  }

  /**
   * Syncs config groups for a CONFIG project from gitops YAML content.
   * Entries from `yamlContent` are added/replaced for the named group in the draft revision.
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
      group = await this.groupRepo.save(
        this.groupRepo.create({ revisionId: draft.id, name: groupName, isGlobal, gitFilePath }),
      );
    } else {
      group.isGlobal = isGlobal;
      group.gitFilePath = gitFilePath;
      await this.groupRepo.save(group);
    }

    // Replace entries from yaml content
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const savedGroup = group!;
    await this.entryRepo.delete({ groupId: savedGroup.id });
    const entries = Object.entries(yamlContent).map(([key, value]) =>
      this.entryRepo.create({ groupId: savedGroup.id, key, value: String(value) }),
    );
    if (entries.length > 0) await this.entryRepo.save(entries);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Assembles the final device config payload (without resolving vault secrets)
   * by merging CONFIG_MAP baseline + device config project overrides.
   * This is the single source of truth for what goes into the S3 cache.
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
    const configMapGroups: Record<string, Record<string, string | null>> = {};
    const globalConfigMapEntries: Record<string, string | null> = {};

    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull(), deviceId: IsNull(), configProjectId: IsNull() }, // global
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
        { deviceId }, // device-id direct association
      ],
    });

    if (applicableAssocs.length > 0) {
      const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
      const activeRevisions = await this.revisionRepo.find({
        where: { projectId: In(configMapProjectIds), status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: { entries: true } },
      });

      for (const rev of activeRevisions) {
        const globalsEntries = this.collectGlobals(rev.groups);
        for (const group of rev.groups) {
          if (group.isGlobal) continue;
          const groupEntries = await this.resolveGroupEntries(group.entries, { ...globalsEntries }, false);
          configMapGroups[group.name] = { ...(configMapGroups[group.name] ?? {}), ...groupEntries };
        }
        Object.assign(globalConfigMapEntries, globalsEntries);
      }
    }

    // --- Device config project groups (higher priority) ---
    const deviceGroups: Record<string, Record<string, string | null>> = {};
    const globalDeviceEntries: Record<string, string | null> = {};
    let configRevisionId: number | null = null;
    let activeSemVer: string | null = null;

    if (configProject) {
      const activeRevision = await this.revisionRepo.findOne({
        where: { projectId: configProject.id, status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: { entries: true } },
      });

      if (activeRevision) {
        configRevisionId = activeRevision.id;
        activeSemVer = activeRevision.semVer;
        const globalsEntries = this.collectGlobals(activeRevision.groups);
        Object.assign(globalDeviceEntries, globalsEntries);

        for (const group of activeRevision.groups) {
          if (group.isGlobal) continue;
          const groupEntries = await this.resolveGroupEntries(group.entries, { ...globalsEntries }, false);
          deviceGroups[group.name] = groupEntries;
        }
      }
    }

    // --- Merge: configMap baseline + device overrides ---
    const mergedGroups: Record<string, Record<string, string | null>> = {};
    const allGroupNames = new Set([...Object.keys(configMapGroups), ...Object.keys(deviceGroups)]);
    const combinedGlobals = { ...globalConfigMapEntries, ...globalDeviceEntries };

    for (const name of allGroupNames) {
      const merged: Record<string, string | null> = {
        ...combinedGlobals,
        ...(configMapGroups[name] ?? {}),
        ...(deviceGroups[name] ?? {}),
      };

      // Remove tombstoned/null keys
      for (const key of Object.keys(merged)) {
        const value = merged[key];
        if (value == null || value === 'null' || value === 'undefined') {
          delete merged[key];
        }
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

  /**
   * Assembles the device config and writes it to the versioned S3 cache.
   * Called fire-and-forget from applyRevision / cascade flows.
   */
  private async assembleAndCacheDeviceConfig(deviceId: string, semVer: string): Promise<void> {
    const payload = await this.buildDeviceConfigPayload(deviceId);
    await this.cacheService.setByVersion(deviceId, semVer, payload as any);
  }

  /**
   * Computes the next semantic version for a config revision based on the diff
   * between the previous ACTIVE revision's groups and the incoming draft groups.
   *
   * Rules (highest priority wins):
   *   - New group added           → major bump (breaking structural change)
   *   - Group removed             → major bump (breaking structural change)
   *   - Entry key deleted         → major bump (breaks existing consumers)
   *   - Entry key added           → minor bump (backward-compatible addition)
   *   - Entry value updated       → minor bump (backward-compatible change)
   *   - No structural change      → patch bump
   *
   * When there is no previous revision the initial version is `1.0.0`.
   */
  private computeNextSemVer(
    prevGroups: ConfigGroupEntity[] | undefined | null,
    draftGroups: ConfigGroupEntity[],
    prevSemVer: string | null,
  ): string {
    if (!prevGroups || prevGroups.length === 0) {
      // First publication: always start at 1.0.0
      return '1.0.0';
    }

    let major = 0;
    let minor = 0;
    let patch = 0;
    if (prevSemVer) {
      const parts = prevSemVer.split('.').map(Number);
      [major, minor, patch] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    }

    // Build lookup maps: groupName → (key → value)
    const prevMap = new Map<string, Map<string, string | null>>();
    for (const g of prevGroups) {
      const em = new Map<string, string | null>();
      for (const e of g.entries ?? []) em.set(e.key, e.value);
      prevMap.set(g.name, em);
    }

    const draftMap = new Map<string, Map<string, string | null>>();
    for (const g of draftGroups) {
      const em = new Map<string, string | null>();
      for (const e of g.entries ?? []) em.set(e.key, e.value);
      draftMap.set(g.name, em);
    }

    let hasMajorChange = false;
    let hasMinorChange = false;

    // Groups present in draft
    for (const [groupName, draftEntries] of draftMap) {
      const prevEntries = prevMap.get(groupName);
      if (!prevEntries) {
        // New group added → major
        hasMajorChange = true;
        continue;
      }
      // Compare entries within existing group
      for (const [key, value] of draftEntries) {
        if (!prevEntries.has(key)) {
          hasMinorChange = true; // key added to existing group → minor
        } else if (prevEntries.get(key) !== value) {
          hasMinorChange = true; // key value updated → minor
        }
      }
      // Keys that existed before but are now gone → major (deletion)
      for (const key of prevEntries.keys()) {
        if (!draftEntries.has(key)) {
          hasMajorChange = true;
        }
      }
    }

    // Groups that existed before but are now removed → major
    for (const groupName of prevMap.keys()) {
      if (!draftMap.has(groupName)) {
        hasMajorChange = true;
      }
    }

    if (hasMajorChange) return `${major + 1}.0.0`;
    if (hasMinorChange) return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }

  private collectGlobals(groups: ConfigGroupEntity[]): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const group of groups) {
      if (!group.isGlobal) continue;
      for (const entry of group.entries) {
        // Globals are NOT resolved here (secrets still as vault refs) since we
        // use this for building the structure; resolution happens per-group
        result[entry.key] = entry.value;
      }
    }
    return result;
  }

  /**
   * Scans every value in the merged groups map for Vault references and resolves
   * them to plaintext. Used to enrich the cached (secret-free) payload before
   * returning it to a caller that has requested secret resolution.
   * The cached object itself is never mutated.
   */
  private async resolveVaultRefsInGroups(
    groups: Record<string, Record<string, string | null>>,
  ): Promise<Record<string, Record<string, string | null>>> {
    const result: Record<string, Record<string, string | null>> = {};
    for (const [groupName, entries] of Object.entries(groups)) {
      const resolved: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (value != null && this.vaultService.isVaultRef(value)) {
          try {
            resolved[key] = (await this.vaultService.resolveSecret(value)) ?? null;
          } catch {
            resolved[key] = null;
          }
        } else {
          resolved[key] = value;
        }
      }
      result[groupName] = resolved;
    }
    return result;
  }

  private async resolveGroupEntries(
    entries: ConfigEntryEntity[],
    globals: Record<string, string | null>,
    resolveSecrets: boolean,
  ): Promise<ConfigGroupValuesMap> {
    const result: Record<string, string | null> = { ...globals };
    for (const entry of entries) {
      if (resolveSecrets && entry.isSensitive && this.vaultService.isVaultRef(entry.value)) {
        try {
          result[entry.key] = await this.vaultService.resolveSecret(entry.value) ?? null;
        } catch {
          result[entry.key] = null;
        }
      } else {
        result[entry.key] = entry.value;
      }
    }
    return result;
  }

  private mapEntryToDto(entry: ConfigEntryEntity, exposeVaultRef: boolean): ConfigEntryDto {
    return {
      id: entry.id,
      key: entry.key,
      value: exposeVaultRef ? entry.value : entry.isSensitive ? '***' : entry.value,
      isSensitive: entry.isSensitive,
    };
  }

  private mapGroupToDto(group: ConfigGroupEntity): ConfigGroupDto {
    return {
      id: group.id,
      name: group.name,
      isGlobal: group.isGlobal,
      gitFilePath: group.gitFilePath,
      entries: (group.entries ?? []).map((e) => this.mapEntryToDto(e, false)),
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
