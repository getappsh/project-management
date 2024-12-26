import { Injectable, Logger } from "@nestjs/common";
import { OidcService } from "./oidc.interface";
import { UserDto } from "../dto/oidc/dto/user.dto";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class KcService implements OidcService {

  private readonly logger = new Logger(KcService.name);

  BASE_URL = process.env.AUTH_SERVER_URL;
  accessToken: string = '';
  expiredAccessToken: number = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService
  ) { }

  async authenticate(): Promise<void> {
    if (this.expiredAccessToken < Date.now() + 5000) {
      await this.login();
    }
  }

  async login() {
    this.logger.log('login as admin to keycloak');

    const relativeUrl = '/realms/getapp/protocol/openid-connect/token';

    const data = new URLSearchParams();
    data.append('client_id', 'admin-cli');
    data.append('username', this.config.get('KC_ADMIN_USER'));
    data.append('password', this.config.get('KC_ADMIN_PASSWORD'));
    data.append('grant_type', 'password');

    let headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    }

    const res = await this.httpService.axiosRef.post(this.BASE_URL + relativeUrl, data, { headers: headers })
    this.accessToken = res.data.access_token;
    this.expiredAccessToken = Date.now() + res.data.expires_in * 1000;

  }

  async getUsers(params?: Partial<{ [key in keyof UserDto]: any }>): Promise<UserDto[]> {
    this.logger.log('get all users');

    await this.authenticate();

    let query = '';
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        query += `&${key}=${value}`
      })
    }

    const relativeUrl = '/admin/realms/getapp/users';

    let headers = {
      'Authorization': 'Bearer ' + this.accessToken
    }

    const res = await this.httpService.axiosRef.get(this.BASE_URL + relativeUrl + "?" + query, { headers: headers })
    const resUsers = res.data.map(UserDto.fromUserDto)

    console.log(resUsers);


    return resUsers;
  }
}