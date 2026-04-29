import crypto from 'crypto';
import { getSecretEncryptionKeyBytes } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

export function encryptSecret(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Secret value is required');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getSecretEncryptionKeyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64')).join('.');
}

export function decryptSecret(value) {
  if (!value) return '';
  const [ivText, tagText, encryptedText] = String(value).split('.');
  if (!ivText || !tagText || !encryptedText) {
    throw new Error('Encrypted secret format is invalid');
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getSecretEncryptionKeyBytes(),
    Buffer.from(ivText, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64')),
    decipher.final()
  ]).toString('utf8');
}
