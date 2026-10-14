import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => false),
    getSelectedStorageBackend: jest.fn(() => 'basic_text'),
    encryptStringAsync: jest.fn(),
    decryptStringAsync: jest.fn(),
  },
}));

import { safeStorage } from 'electron';
import { SecureStorageService } from '../secure-storage-service';

const mockSafeStorage = safeStorage as jest.Mocked<typeof safeStorage>;

describe('Electron secure-storage password fallback', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'outlink-secure-storage-test-'));
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('requires setup, encrypts values, and unlocks a later process', async () => {
    const first = new SecureStorageService(directory);
    await expect(first.accessStatus()).resolves.toBe('password_setup_required');
    await first.configurePassword('correct horse battery staple');
    await first.setItem('wallet-key', 'secret-value');
    await expect(first.configurePassword('replacement password')).rejects.toThrow(
      'already configured',
    );

    const raw = await fs.readFile(path.join(directory, 'secrets.password.enc'), 'utf8');
    expect(raw).not.toContain('secret-value');

    const second = new SecureStorageService(directory);
    await expect(second.accessStatus()).resolves.toBe('password_required');
    await expect(second.unlockWithPassword('wrong password')).resolves.toBe(false);
    await expect(second.unlockWithPassword('correct horse battery staple')).resolves.toBe(true);
    await expect(second.getItem('wallet-key')).resolves.toBe('secret-value');
  });

  it('refuses to replace an inaccessible OS-encrypted vault', async () => {
    await fs.writeFile(path.join(directory, 'secrets.enc'), 'existing encrypted data');
    const service = new SecureStorageService(directory);

    await expect(service.accessStatus()).rejects.toThrow('existing OS-encrypted vault');
    await expect(service.configurePassword('correct horse battery staple')).rejects.toThrow(
      'Cannot replace',
    );
  });
});


describe('password vault integrity and setup ordering', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'outlink-vault-integrity-test-'));
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each([4, 8, 12, 13, 14, 15])('rejects an otherwise valid envelope with a %i-byte tag', async (length) => {
    const first = new SecureStorageService(directory);
    await first.configurePassword('correct horse battery staple');
    await first.setItem('wallet-key', 'secret-value');
    const file = path.join(directory, 'secrets.password.enc');
    const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
    envelope.tag = Buffer.from(envelope.tag, 'base64').subarray(0, length).toString('base64');
    await fs.writeFile(file, JSON.stringify(envelope));

    const second = new SecureStorageService(directory);
    await expect(second.unlockWithPassword('correct horse battery staple')).resolves.toBe(false);
    await expect(second.getItem('wallet-key')).rejects.toThrow('password is required');
  });

  it.each(['salt', 'iv', 'tag'])('rejects noncanonical base64 in %s', async (field) => {
    const service = new SecureStorageService(directory);
    await service.configurePassword('correct horse battery staple');
    const file = path.join(directory, 'secrets.password.enc');
    const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
    envelope[field] += '!';
    await fs.writeFile(file, JSON.stringify(envelope));
    await expect(new SecureStorageService(directory).unlockWithPassword('correct horse battery staple'))
      .resolves.toBe(false);
  });

  it('allows only one concurrent setup and keeps queued secrets', async () => {
    const service = new SecureStorageService(directory);
    const results = await Promise.allSettled([
      service.configurePassword('first correct password'),
      service.configurePassword('second correct password'),
      service.setItem('wallet-key', 'secret-value'),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    const second = new SecureStorageService(directory);
    await expect(second.unlockWithPassword('second correct password')).resolves.toBe(false);
    await expect(second.unlockWithPassword('first correct password')).resolves.toBe(true);
    await expect(second.getItem('wallet-key')).resolves.toBe('secret-value');
  });

  it('orders an unlock immediately after setup', async () => {
    const service = new SecureStorageService(directory);
    const results = await Promise.all([
      service.configurePassword('correct horse battery staple'),
      service.unlockWithPassword('correct horse battery staple'),
      service.setItem('wallet-key', 'secret-value'),
    ]);
    expect(results[1]).toBe(true);
    await expect(service.getItem('wallet-key')).resolves.toBe('secret-value');
  });
});
