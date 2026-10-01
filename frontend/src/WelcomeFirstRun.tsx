/**
 * F3#9 security residual — first-run vault setup WITHOUT mounting DesktopShell.
 * Overlay stays open until createMythosVault resolves successfully; cancel/error
 * leave the user on the overlay (no incomplete-onboarding shell).
 */
import { useCallback, useState } from 'react';
import WelcomeOverlay, {
  markWelcomeOverlayDismissed,
  type WelcomePathId,
} from './WelcomeOverlay';
import { useCreateMythosVaultFlow } from './useCreateMythosVaultFlow';
import { mapWelcomeSetupError } from './welcomeSetupError';

interface WelcomeFirstRunProps {
  settings: AppSettings;
  onComplete: (next: AppSettings) => void;
}

export default function WelcomeFirstRun({ settings, onComplete }: WelcomeFirstRunProps) {
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);

  const { createVault, createVaultModal } = useCreateMythosVaultFlow(
    useCallback(async () => {
      const next: AppSettings = { ...settings, onboardingComplete: true };
      await window.api?.settingsSet?.(next);
      markWelcomeOverlayDismissed();
      onComplete(next);
    }, [settings, onComplete]),
  );

  const handlePickPath = useCallback(async (id: WelcomePathId) => {
    setSetupError(null);
    setSetupBusy(true);
    try {
      const outcome = await createVault(id);
      if (outcome === 'cancelled') {
        // Stay on overlay — no shell, no dismissal, no error banner.
        return;
      }
      // 'created' → onCreated already called onComplete (this unmounts).
    } catch (err) {
      setSetupError(mapWelcomeSetupError(err));
    } finally {
      setSetupBusy(false);
    }
  }, [createVault]);

  return (
    <div className="root-layout" data-testid="welcome-first-run" data-shell-mounted="false">
      <WelcomeOverlay
        requireVaultSetup
        setupError={setupError}
        setupBusy={setupBusy}
        onSkip={() => { /* hidden when requireVaultSetup */ }}
        onPickPath={handlePickPath}
      />
      {createVaultModal}
    </div>
  );
}
