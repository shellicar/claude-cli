import { randomBytes } from 'node:crypto';
import { base64UrlEncode } from './base64UrlEncode';

export const generateCodeVerifier = () => base64UrlEncode(randomBytes(32));
