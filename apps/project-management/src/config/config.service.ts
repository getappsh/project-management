import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  ConfigEntryEntity,
  ConfigGroupEntity,
  ConfigMapAssociationEntity,
  ConfigRevisionEntity,
  ConfigRevisionStatus,
  DeviceEntity,
  DeviceTypeEntity,
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
  ConfigRevisionDto,
  DeleteConfigEntryDto,
  DeleteConfigGroupDto,
  DeviceConfigDto,
  GetConfigRevisionByIdDto,
  GetConfigRevisionsDto,
  GetDeviceConfigDto,
  RemoveConfigMapAssociationDto,
  UpsertConfigEntryDto,
  UpsertConfigGroupDto,
} from '@app/common/dto/project-management';
import { VaultService } from '@app/common/vault';
import { ConfigCacheService } from './config-cache.service';

const CONFIG_VAULT_SECRET_NAME = (entryId: number) => `config-entry-${entryId}`;
const CONFIG_VAULT_FIELD = 'config_value' as const;

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ConfigRevisionEntity) private readonly revisionRepo: Repository<ConfigRevisionEntity>,
    @InjectRepository(ConfigGroupEntity) private readonly groupRepo: Repository<ConfigGroupEntity>,
    @InjectRepository(ConfigEntryEntity) private readonly entryRepo: Repository<ConfigEntryEntity>,
    @InjectRepository(ConfigMapAssociationEntity) private readonly assocRepo: Repository<ConfigMapAssociationEntity>,
    @InjectRepository(DeviceEntity) private readonly deviceRepo: Repository<DeviceEntity>,
    @InjectRepository(DeviceTypeEntity) private readonly deviceTypeRepo: Repository<DeviceTypeEntity>,
    private readonly vaultService: VaultService,
    private readonly cacheService: ConfigCacheService,
  ) {}

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

  async deleteGroup(dto: DeleteConfigGroupDto): Promise<void> {
    const project = await this.requireProject(dto.projectIdentifier, [
      ProjectType.CONFIG,
      ProjectType.CONFIG_MAP,
    ]);
    const draft = await this.getOrCreateDraftRevision(project.id);
    const group = await this.groupRepo.findOne({ where: { revisionId: draft.id, name: dto.groupName } });
    if (!group) throw new NotFoundException(`Group '${dto.groupName}' not found in draft revision`);
    await this.groupRepo.remove(group);
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

  async deleteEntry(dto: DeleteConfigEntryDto): Promise<void> {
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

    // Archive the current active revision
    await this.revisionRepo.update(
      { projectId: project.id, status: ConfigRevisionStatus.ACTIVE },
      { status: ConfigRevisionStatus.ARCHIVED },
    );

    // Promote the draft to active
    draft.status = ConfigRevisionStatus.ACTIVE;
    draft.appliedBy = dto.appliedBy ?? null;
    draft.appliedAt = new Date();
    await this.revisionRepo.save(draft);

    // Create a fresh empty draft for subsequent edits
    const maxResult = await this.revisionRepo
      .createQueryBuilder('r')
      .select('MAX(r.revisionNumber)', 'max')
      .where('r.projectId = :projectId', { projectId: project.id })
      .getRawOne<{ max: number | null }>();
    const nextNumber = (maxResult?.max ?? 0) + 1;

    await this.revisionRepo.save(
      this.revisionRepo.create({ projectId: project.id, revisionNumber: nextNumber, status: ConfigRevisionStatus.DRAFT }),
    );

    this.logger.log(`Applied revision ${draft.id} (rev#${draft.revisionNumber}) for project ${project.id}`);
    return this.mapRevisionToDto(draft, true);
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

  // ---------------------------------------------------------------------------
  // ConfigMap Associations
  // ---------------------------------------------------------------------------

  async addConfigMapAssociation(dto: AddConfigMapAssociationDto): Promise<ConfigMapAssociationDto> {
    const project = await this.requireProject(dto.configMapProjectIdentifier, ProjectType.CONFIG_MAP);

    if (dto.deviceTypeId) {
      const dt = await this.deviceTypeRepo.findOne({ where: { id: dto.deviceTypeId } });
      if (!dt) throw new NotFoundException(`Device type ${dto.deviceTypeId} not found`);
    }

    const assoc = await this.assocRepo.save(
      this.assocRepo.create({
        configMapProjectId: project.id,
        deviceTypeId: dto.deviceTypeId ?? null,
      }),
    );
    return { id: assoc.id, configMapProjectId: assoc.configMapProjectId, deviceTypeId: assoc.deviceTypeId };
  }

  async removeConfigMapAssociation(dto: RemoveConfigMapAssociationDto): Promise<void> {
    const assoc = await this.assocRepo.findOne({ where: { id: dto.associationId } });
    if (!assoc) throw new NotFoundException(`Association ${dto.associationId} not found`);
    await this.assocRepo.remove(assoc);
  }

  async getConfigMapAssociations(configMapProjectIdentifier: number | string): Promise<ConfigMapAssociationDto[]> {
    const project = await this.requireProject(configMapProjectIdentifier, ProjectType.CONFIG_MAP);
    const assocs = await this.assocRepo.find({ where: { configMapProjectId: project.id } });
    return assocs.map((a) => ({ id: a.id, configMapProjectId: a.configMapProjectId, deviceTypeId: a.deviceTypeId }));
  }

  // ---------------------------------------------------------------------------
  // Device config project auto-creation (called from discovery)
  // ---------------------------------------------------------------------------

  /**
   * Ensures a CONFIG project exists for `deviceId`.
   * Attaches any CONFIG_MAP projects whose associations match the device's device types.
   * Returns the project id.
   */
  async ensureDeviceConfigProject(deviceId: string): Promise<number> {
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

      // Create the first draft revision
      await this.getOrCreateDraftRevision(project.id);
    }

    return project.id;
  }

  // ---------------------------------------------------------------------------
  // Final device config assembly (for agent)
  // ---------------------------------------------------------------------------

  async getDeviceConfig(dto: GetDeviceConfigDto): Promise<DeviceConfigDto> {
    const resolveSecrets = dto.resolveSecrets !== false;
    const { deviceId } = dto;

    // Find the device's config project
    const projectName = `config:${deviceId}`;
    const configProject = await this.projectRepo.findOne({ where: { name: projectName, projectType: ProjectType.CONFIG } });

    // Find device types for this device to look up applicable configMaps
    const device = await this.deviceRepo.findOne({ where: { ID: deviceId } });
    const deviceTypeIds: number[] = [];
    if (device) {
      const rawTypes = await this.deviceRepo
        .createQueryBuilder('d')
        .relation('deviceType')
        .of(device)
        .loadMany() as DeviceTypeEntity[];
      deviceTypeIds.push(...rawTypes.map((dt) => dt.id));
    }

    // Collect the revision IDs that contribute to the final config (for cache hashing)
    const contributingRevisionIds: number[] = [];

    // --- ConfigMap groups (lowest priority, device config can override) ---
    const configMapGroups: Record<string, Record<string, string | null>> = {};
    const globalConfigMapEntries: Record<string, string | null> = {};

    const applicableAssocs = await this.assocRepo.find({
      where: [
        { deviceTypeId: IsNull() }, // global configMaps
        ...(deviceTypeIds.length > 0 ? [{ deviceTypeId: In(deviceTypeIds) }] : []),
      ],
    });

    if (applicableAssocs.length > 0) {
      const configMapProjectIds = [...new Set(applicableAssocs.map((a) => a.configMapProjectId))];
      const activeRevisions = await this.revisionRepo.find({
        where: { projectId: In(configMapProjectIds), status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: { entries: true } },
      });

      for (const rev of activeRevisions) {
        contributingRevisionIds.push(rev.id);
        const globalsEntries = this.collectGlobals(rev.groups);
        for (const group of rev.groups) {
          if (group.isGlobal) continue;
          const groupEntries = await this.resolveGroupEntries(group.entries, { ...globalsEntries }, resolveSecrets);
          configMapGroups[group.name] = { ...(configMapGroups[group.name] ?? {}), ...groupEntries };
        }
        Object.assign(globalConfigMapEntries, globalsEntries);
      }
    }

    // --- Device config project groups (higher priority, override configMap values) ---
    const deviceGroups: Record<string, Record<string, string | null>> = {};
    const globalDeviceEntries: Record<string, string | null> = {};
    let configRevisionId: number | null = null;

    if (configProject) {
      const activeRevision = await this.revisionRepo.findOne({
        where: { projectId: configProject.id, status: ConfigRevisionStatus.ACTIVE },
        relations: { groups: { entries: true } },
      });

      if (activeRevision) {
        configRevisionId = activeRevision.id;
        contributingRevisionIds.push(activeRevision.id);
        const globalsEntries = this.collectGlobals(activeRevision.groups);
        Object.assign(globalDeviceEntries, globalsEntries);

        for (const group of activeRevision.groups) {
          if (group.isGlobal) continue;
          const groupEntries = await this.resolveGroupEntries(group.entries, { ...globalsEntries }, resolveSecrets);
          deviceGroups[group.name] = groupEntries;
        }
      }
    }

    // --- Merge: configMap + device config (device overrides), then apply global entries ---
    const mergedGroups: Record<string, Record<string, string | null>> = {};
    const allGroupNames = new Set([...Object.keys(configMapGroups), ...Object.keys(deviceGroups)]);
    const combinedGlobals = { ...globalConfigMapEntries, ...globalDeviceEntries };

    for (const name of allGroupNames) {
      mergedGroups[name] = {
        ...combinedGlobals,
        ...(configMapGroups[name] ?? {}),
        ...(deviceGroups[name] ?? {}),
      };
    }

    // --- S3 cache (no secrets) ---
    if (!resolveSecrets) {
      const hash = this.cacheService.computeConfigHash(contributingRevisionIds);
      const cached = await this.cacheService.get(deviceId, hash);
      if (cached) return cached as DeviceConfigDto;
      const payload: DeviceConfigDto = { deviceId, configRevisionId, groups: mergedGroups, computedAt: new Date().toISOString() };
      await this.cacheService.set(deviceId, hash, payload as any);
      return payload;
    }

    return { deviceId, configRevisionId, groups: mergedGroups, computedAt: new Date().toISOString() };
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
      createdAt: revision.createdAt,
      ...(includeGroups && revision.groups ? { groups: revision.groups.map((g) => this.mapGroupToDto(g)) } : {}),
    };
  }
}
