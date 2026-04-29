import bcrypt from 'bcrypt';

const COST = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
