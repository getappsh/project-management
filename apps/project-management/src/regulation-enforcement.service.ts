import { RegulationEntity } from "@app/common/database/entities";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";

@Injectable()
export class RegulationEnforcementService {
  private readonly logger = new Logger(RegulationEnforcementService.name);

  async enforce(regulation: RegulationEntity, value: string): Promise<boolean> {
    this.logger.log(`Enforce regulation: ${regulation.name}, type: ${regulation.type.name}, value: ${value}`);
    switch (regulation.type.name) {
      case 'Boolean':
        return "true" === value;
      case 'Threshold':
        if (isNaN(+value)) return false;
        return Number(regulation.config) <= Number(value);
      case 'JUnit':
        // TODO ...
        return true

      default:
        throw new Error(`Unsupported regulation type: ${regulation.type.name}`);
    }
  }
  

  validateConfig(regulation: RegulationEntity) {
    switch (regulation.type.name) {
      case 'Boolean':
        regulation.config = undefined;
        break;
      case 'Threshold':
        const configValue = Number(regulation.config);
        if (isNaN(configValue)) {
            throw new BadRequestException('Config value for Threshold type must be a number');
        }
        break
    }
  }
  
}
