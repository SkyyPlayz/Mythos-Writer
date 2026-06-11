export type CloudProvider = 'dropbox' | 'google-drive' | 'icloud' | 'onedrive' | null;

const PROVIDER_PATTERNS: Array<{ provider: Exclude<CloudProvider, null>; pattern: RegExp }> = [
  { provider: 'dropbox', pattern: /(^|[/\\])Dropbox([/\\]|$)/i },
  { provider: 'google-drive', pattern: /(^|[/\\])(Google Drive|GoogleDrive|My Drive|Google Drive File Stream)([/\\]|$)/i },
  { provider: 'icloud', pattern: /(^|[/\\])(iCloud Drive|iCloudDrive|Mobile Documents[/\\]com~apple~CloudDocs)([/\\]|$)/i },
  { provider: 'onedrive', pattern: /(^|[/\\])OneDrive(?:\s-\s[^/\\]+)?([/\\]|$)/i },
];

export function detectCloudProvider(path: string | null | undefined): CloudProvider {
  if (!path?.trim()) return null;

  const normalized = path.trim();
  for (const { provider, pattern } of PROVIDER_PATTERNS) {
    if (pattern.test(normalized)) return provider;
  }

  return null;
}

export function getCloudProviderLabel(provider: Exclude<CloudProvider, null>): string {
  switch (provider) {
    case 'dropbox':
      return 'Dropbox';
    case 'google-drive':
      return 'Google Drive';
    case 'icloud':
      return 'iCloud Drive';
    case 'onedrive':
      return 'OneDrive';
  }
}
