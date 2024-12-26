import { UserDto } from "../dto/oidc/dto/user.dto";

export interface OidcService {
  authenticate(): Promise<void>
  getUsers(params?: { [key in keyof UserDto]: string }): Promise<UserDto[]>
}