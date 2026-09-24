import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ExperienceResponse {
  @ApiProperty({ enum: Role, example: Role.VENDOR })
  role!: Role;

  @ApiProperty({ example: 'I want to list my equipment or services' })
  label!: string;

  @ApiProperty({
    description: 'The user already holds this role and can switch to it straight away.',
    example: false,
  })
  granted!: boolean;

  @ApiProperty({
    description:
      'Whether the role-specific profile exists. A vendor who has started onboarding holds ' +
      'the role but may not be verified yet.',
    example: false,
  })
  hasProfile!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Where to send the user to become this, when they are not yet. Null once granted.',
    example: 'POST /api/v1/vendor/onboarding',
  })
  onboardingEndpoint!: string | null;
}

export class MeResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Yoseph Alemu' })
  name!: string;

  @ApiProperty({ example: 'yoseph@habeshafilms.et' })
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  image!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+251911234567' })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'yoseph_a' })
  telegramUsername!: string | null;

  @ApiProperty({
    enum: Role,
    description: 'Which experience the app should open in.',
    example: Role.CUSTOMER,
  })
  activeRole!: Role;

  @ApiProperty({
    enum: Role,
    isArray: true,
    description: 'Every role granted. Switching experience never adds or removes one.',
    example: [Role.CUSTOMER],
  })
  roles!: Role[];

  @ApiProperty({
    type: [ExperienceResponse],
    description: 'The options on the "How will you use Eskista?" screen, with their state.',
  })
  experiences!: ExperienceResponse[];

  @ApiProperty({
    description:
      'True for a user who has never chosen an experience. Show the chooser once, then ' +
      'never again — switching afterwards lives on the Profile tab.',
    example: true,
  })
  needsExperienceChoice!: boolean;
}

export class SwitchRoleDto {
  @ApiProperty({
    enum: [Role.CUSTOMER, Role.VENDOR, Role.TALENT],
    example: Role.CUSTOMER,
    description: 'The experience to open in.',
  })
  @IsEnum(Role)
  role!: Role;
}
