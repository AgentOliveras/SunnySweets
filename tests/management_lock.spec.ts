import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  generateSalt,
  hashPin,
  verifyManagementPin,
  loadManagementLockConfig,
  saveManagementLockConfig,
  isManagementLockEnabled,
  ManagementLockConfig,
} from '../src/utils/managementLock';

// In-memory mock for localStorage in Node test environment
const mockStorage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
};

describe('Management Mode Lock — Security & Guard Invariants', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it('1. Salt generation creates unique random salts with appropriate length', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    assert.ok(salt1.length >= 16, 'Salt should be at least 16 hex chars (64+ bits)');
    assert.notStrictEqual(salt1, salt2, 'Consecutive salts must be unique');
  });

  it('2. Hash calculation is deterministic given the same PIN and salt', async () => {
    const salt = 'a1b2c3d4e5f67890';
    const pin = '1234';

    const hash1 = await hashPin(pin, salt);
    const hash2 = await hashPin(pin, salt);

    assert.strictEqual(hash1, hash2, 'Identical PIN and salt must yield identical hash');
    assert.strictEqual(hash1.length, 64, 'SHA-256 hex string should be 64 characters long');
  });

  it('3. Different PINs or salts produce completely distinct hashes', async () => {
    const salt1 = 'a1b2c3d4e5f67890';
    const salt2 = 'f0e1d2c3b4a59876';

    const hashA = await hashPin('1234', salt1);
    const hashB = await hashPin('5678', salt1);
    const hashC = await hashPin('1234', salt2);

    assert.notStrictEqual(hashA, hashB, 'Different PINs must have distinct hashes');
    assert.notStrictEqual(hashA, hashC, 'Different salts must have distinct hashes');
  });

  it('4. verifyManagementPin returns true for correct PIN and false for wrong PIN', async () => {
    const salt = generateSalt();
    const pin = '4826';
    const hash = await hashPin(pin, salt);

    const config: ManagementLockConfig = {
      enabled: true,
      salt,
      hash,
      updatedAt: new Date().toISOString(),
    };

    const validResult = await verifyManagementPin('4826', config);
    assert.strictEqual(validResult, true, 'Correct PIN must verify successfully');

    const invalidResult = await verifyManagementPin('9999', config);
    assert.strictEqual(invalidResult, false, 'Incorrect PIN must fail verification');

    const emptyResult = await verifyManagementPin('', config);
    assert.strictEqual(emptyResult, false, 'Empty PIN must fail verification');
  });

  it('5. Disabled or unconfigured lock automatically permits access without PIN prompt', async () => {
    const disabledConfig: ManagementLockConfig = {
      enabled: false,
      salt: '',
      hash: '',
    };

    const result = await verifyManagementPin('', disabledConfig);
    assert.strictEqual(result, true, 'Disabled lock should verify true');
    assert.strictEqual(isManagementLockEnabled(), false);
  });

  it('6. Plaintext PIN is NEVER saved into storage', async () => {
    const secretPin = '8391';
    const salt = generateSalt();
    const hash = await hashPin(secretPin, salt);

    const config: ManagementLockConfig = {
      enabled: true,
      salt,
      hash,
      updatedAt: new Date().toISOString(),
    };

    saveManagementLockConfig(config);

    const rawStored = (globalThis as any).localStorage.getItem('SS_MGMT_LOCK_CONFIG');
    assert.ok(rawStored, 'Config must be stored in localStorage');
    assert.strictEqual(
      rawStored.includes(secretPin),
      false,
      'CRITICAL: Plaintext PIN must NEVER appear in localStorage'
    );

    const loaded = loadManagementLockConfig();
    assert.strictEqual(loaded.enabled, true);
    assert.strictEqual(loaded.hash, hash);
    assert.strictEqual(loaded.salt, salt);
    assert.strictEqual(isManagementLockEnabled(), true);
  });

  it('7. Malformed or missing localStorage data safely defaults to disabled without crashing', () => {
    (globalThis as any).localStorage.setItem('SS_MGMT_LOCK_CONFIG', 'invalid-json{{{');
    const loaded = loadManagementLockConfig();

    assert.strictEqual(loaded.enabled, false);
    assert.strictEqual(loaded.salt, '');
    assert.strictEqual(loaded.hash, '');
  });

  it('8. Enabled lock with missing or malformed hash/salt FAILS CLOSED (never permits unlock)', async () => {
    const missingHashConfig: ManagementLockConfig = {
      enabled: true,
      salt: generateSalt(),
      hash: '',
    };
    const missingSaltConfig: ManagementLockConfig = {
      enabled: true,
      salt: '',
      hash: await hashPin('1234', generateSalt()),
    };

    assert.strictEqual(await verifyManagementPin('1234', missingHashConfig), false);
    assert.strictEqual(await verifyManagementPin('1234', missingSaltConfig), false);
  });
});
