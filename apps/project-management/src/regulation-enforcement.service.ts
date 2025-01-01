import { RegulationEntity } from "@app/common/database/entities";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { JUnitParserService } from "./utils/junit-parser.service";

@Injectable()
export class RegulationEnforcementService {
  private readonly logger = new Logger(RegulationEnforcementService.name);

  constructor(
    private readonly junitParser: JUnitParserService,
  ){}

  async enforce(regulation: RegulationEntity, value: string): Promise<boolean> {
    this.logger.log(`Enforce regulation: ${regulation.name}, type: ${regulation.type.name}, value: ${value}`);
    switch (regulation.type.name) {
      case 'Boolean':
        return "true" === value;
      
      case 'Threshold':
        if (isNaN(+value)) return false;
        return Number(regulation.config) <= Number(value);

      case 'JUnit':
        const xmlContent = await this.getJUnitXmlContent(value);
        const summary = this.junitParser.extractSummary(xmlContent);
        const passPercentage = (summary.passed / summary.total) * 100;


        this.logger.log(`Test Summary: ${JSON.stringify(summary)}`); 
        this.logger.debug(`Pass Percentage: ${passPercentage}`);

        return Number(regulation.config) <= Number(passPercentage)

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
      case 'JUnit':
        const configValue = Number(regulation.config);
        if (isNaN(configValue)) {
            throw new BadRequestException('Config value for Threshold type must be a number');
        }
        break
    }
  }
  

  private async getJUnitXmlContent(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch JUnit XML content from ${url}`);
    }
    return await response.text();
  }
}
