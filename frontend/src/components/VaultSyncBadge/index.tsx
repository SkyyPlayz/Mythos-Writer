import type { CloudProvider } from '../../lib/cloudSync';
import { getCloudProviderLabel } from '../../lib/cloudSync';
import './VaultSyncBadge.css';

interface Props {
  provider: CloudProvider;
}

export default function VaultSyncBadge({ provider }: Props) {
  if (!provider) {
    return (
      <span className="vault-sync-badge vault-sync-badge--local" aria-label="Vault sync status: Local">
        (Local)
      </span>
    );
  }

  const label = getCloudProviderLabel(provider);

  return (
    <span className="vault-sync-badge vault-sync-badge--synced" aria-label={`Vault sync status: Synced via ${label}`}>
      ✓ Synced via {label}
    </span>
  );
}
