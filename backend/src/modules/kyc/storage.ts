import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Stockage des documents d'identité. Interface volontairement minimale pour pouvoir
 * passer plus tard sur un stockage objet chiffré (S3, R2…) sans toucher au reste du code.
 */
export interface DocumentStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Fichiers sur le disque du serveur, dans un dossier jamais servi publiquement. */
export class LocalDiskStorage implements DocumentStorage {
  private root: string;
  constructor(dir: string) {
    this.root = resolve(dir, 'kyc');
  }
  private path(key: string) {
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error('Clé de stockage invalide'); // pas de ../ possible
    return join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.path(key), data, { mode: 0o600, flag: 'wx' });
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
}

/** Pour les tests. */
export class MemoryStorage implements DocumentStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('Document introuvable');
    return f;
  }
}
