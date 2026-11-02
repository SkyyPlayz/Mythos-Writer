/** 25 MB — well above any scene. Also the import copy cap (MAX_IMPORT_FILE_BYTES). */
export const MAX_VAULT_FILE_BYTES = 25 * 1024 * 1024;

export class VaultFileTooLargeError extends Error {
  readonly sizeBytes: number;
  readonly limitBytes: number;
  constructor(sizeBytes: number, limitBytes = MAX_VAULT_FILE_BYTES) {
    super(
      `File too large: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB exceeds the ${(limitBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
    this.name = 'VaultFileTooLargeError';
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}
