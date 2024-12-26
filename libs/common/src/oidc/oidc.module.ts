import { DynamicModule, Module } from "@nestjs/common";
import { KcService } from "./kc.service";
import { HttpModule } from "@nestjs/axios";
import { DBService } from "./db.service";
import { DatabaseModule } from "../database/database.module";
import { MemberEntity } from "../database/entities";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({})
export class OidcModule {
  static forRoot(provider: 'oidc' | 'db'): DynamicModule {

    const getOidcProvider = () => {
      switch (process.env.OIDC_PROVIDER) {
        case "KEYCLOAK":
          return KcService;
        default:
          return KcService;
      }
    }

    const serviceProvider = {
      provide: 'OidcService',
      useClass: provider === 'oidc' ? getOidcProvider() : DBService,
    };

    return {
      module: OidcModule,
      imports: [
        HttpModule,
        DatabaseModule,
        TypeOrmModule.forFeature([MemberEntity])
      ],
      providers: [serviceProvider],
      exports: [serviceProvider],
    };
  }

}

