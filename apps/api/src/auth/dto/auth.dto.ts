import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email' })
  @MaxLength(254)
  email: string;

  /** ASCII only: lowercasing is unambiguous and look-alike letters from other scripts can't sneak in. */
  @Transform(trim)
  @IsString()
  @Length(3, 24, { message: 'Username must be 3 to 24 characters long' })
  @Matches(/^[a-zA-Z0-9_.]+$/, { message: 'Use only letters, digits, "_" and "."' })
  username: string;

  /** Length only, no composition rules (NIST SP 800-63B). */
  @IsString()
  @Length(8, 128, { message: 'Password must be 8 to 128 characters long' })
  password: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email' })
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(1, 128, { message: 'Enter your password' })
  password: string;
}
