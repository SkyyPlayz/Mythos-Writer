export default function SecurityWarningDialog({
  url,
  onConfirm,
  onCancel,
}: {
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* use full url */ }
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="security-warn-title">
      <div className="settings-panel settings-security-warning" style={{ maxWidth: 420 }}>
        <h3 id="security-warn-title" className="settings-section-title">⚠ Remote Endpoint Warning</h3>
        <p className="settings-hint" style={{ marginBottom: 8 }}>
          This endpoint is not on your local network.
        </p>
        <p className="settings-hint" style={{ marginBottom: 8 }}>
          When you use it, Mythos Writer will send your text to:
        </p>
        <code className="settings-security-hostname">{hostname}</code>
        <p className="settings-hint" style={{ marginTop: 8, marginBottom: 12 }}>
          We cannot inspect or encrypt this traffic before it leaves your device.
          Proceed only if you own or fully trust this endpoint.
        </p>
        <div className="settings-action-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="settings-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="settings-btn settings-btn-danger" onClick={onConfirm}>
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
