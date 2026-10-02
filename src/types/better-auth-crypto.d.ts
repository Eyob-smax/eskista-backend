/**
 * `better-auth/crypto` is published for modern module resolution only; under this project's
 * CommonJS resolution its types are not found. This declares the one function we use —
 * the exact hasher Better Auth's own email sign-in verifies against.
 */
declare module 'better-auth/crypto' {
  export function hashPassword(password: string): Promise<string>;
}
