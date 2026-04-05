import { createHash } from 'node:crypto';
import { base64UrlEncode } from './base64UrlEncode';

export const generateCodeChallenge = (verifier: string) => base64UrlEncode(createHash('sha256').update(verifier).digest());
