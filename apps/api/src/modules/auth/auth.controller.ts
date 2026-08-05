import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Headers, UnauthorizedException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger'
import { IsEmail, IsString, MinLength } from 'class-validator'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/tenant.decorator'

class RegisterDto {
  @IsString() companyName: string
  @IsString() name: string
  @IsEmail() email: string
  @IsString() @MinLength(8) password: string
}

class LoginDto {
  @IsEmail() email: string
  @IsString() password: string
}

class ForgotPasswordDto {
  @IsEmail() email: string
}

class ResetPasswordDto {
  @IsString() token: string
  @IsString() @MinLength(8) newPassword: string
}

class ChangePasswordDto {
  @IsString() currentPassword: string
  @IsString() @MinLength(8) newPassword: string
}

class SsoLoginDto {
  @IsString() token: string
  @IsString() source: string // e.g., 'stormbuddi'
}

class GenerateSsoTokenDto {
  @IsEmail() email: string
  @IsString() source: string // e.g., 'stormbuddi'
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Helper method to verify API key
  private verifyApiKey(apiKey: string | undefined): void {
    const validApiKey = process.env.SSO_API_KEY
    if (!validApiKey || !apiKey || apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API key')
    }
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new tenant and owner' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password)
  }

  @Post('sso-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Single Sign-On login via external CRM' })
  ssoLogin(@Body() dto: SsoLoginDto) {
    return this.auth.ssoLogin(dto.token, dto.source)
  }

  @Post('generate-sso-token')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-api-key', description: 'API Key for SSO token generation' })
  @ApiOperation({ summary: 'Generate SSO token for external CRM (requires API key)' })
  async generateSsoToken(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: GenerateSsoTokenDto,
  ) {
    this.verifyApiKey(apiKey)
    return this.auth.generateSsoToken(dto.email, dto.source)
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email)
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword)
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password (authenticated)' })
  changePassword(@CurrentUser() user: { id: string }, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: { id: string }) {
    return this.auth.getMe(user.id)
  }
}
