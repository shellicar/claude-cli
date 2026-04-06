import { randomBytes } from 'node:crypto';
import { base64UrlEncode } from './base64UrlEncode';

export const generateState = () => base64UrlEncode(randomBytes(32));
