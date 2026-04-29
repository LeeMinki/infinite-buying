import { hashPassword, verifyPassword } from './passwordHasher.js';
import * as usersRepository from '../repositories/usersRepository.js';

export async function register({ email, password }) {
  assertEmail(email);
  assertPassword(password);
  if (usersRepository.getUserByEmail(email)) {
    const error = new Error('Email is already registered');
    error.status = 409;
    throw error;
  }
  const passwordHash = await hashPassword(password);
  return safeUser(usersRepository.createUser({ email, passwordHash }));
}

export async function login({ email, password }) {
  const user = usersRepository.getUserByEmail(email);
  const ok = user && await verifyPassword(String(password || ''), user.passwordHash);
  if (!ok) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  return safeUser(user);
}

export function safeUser(user) {
  return user ? { id: user.id, email: user.email } : null;
}

function assertEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) {
    const error = new Error('Valid email is required');
    error.status = 400;
    throw error;
  }
}

function assertPassword(password) {
  if (String(password || '').length < 8) {
    const error = new Error('Password must be at least 8 characters');
    error.status = 400;
    throw error;
  }
}
