import { useState, useEffect, useRef, useCallback } from 'react';
import type { FC, KeyboardEvent } from 'react';
import { LUCIDE_ICONS, LUCIDE_ICON_NAMES } from '../../lucideRegistry';
import { NodeIcon } from '../../NodeIcon';
import './IconPicker.css';

const EMOJI_QUICK_PICKS = [
  '📖', '📑', '📄', '✏️', '🗡️', '🛡️', '👑', '⭐', '❤️', '🔥',
  '⚡', '🌍', '🗺️', '📍', '🏔️', '🌲', '🏰', '🏠', '👤', '👥',
  '💎', '📦', '🔑', '🔒', '✨', '🌙', '☀️', '🎵', '🖼️', '🕐',
];

interface UserPack { packName: string; icons: string[]; }

interface IconPickerProps {
  currentIcon?: string;
  onSelect: (iconValue: string) => void;
  onClose: () => void;
}

const IconPicker: FC<IconPickerProps> = ({ currentIcon, onSelect, onClose }) => {
  const [tab, setTab] = useState<'emoji' | 'lucide' | 'user'>('emoji');
  const [emojiInput, setEmojiInput] = useState('');
  const [lucideSearch, setLucideSearch] = useState('');
  const [userPacks, setUserPacks] = useState<UserPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === 'user') {
      window.api.iconListUserPacks().then(setUserPacks).catch(() => {});
    }
  }, [tab]);

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  const handleOverlayKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const filteredLucide = lucideSearch
    ? LUCIDE_ICON_NAMES.filter((n) => n.includes(lucideSearch.toLowerCase()))
    : LUCIDE_ICON_NAMES;

  const currentPack = userPacks.find((p) => p.packName === selectedPack);

  return (
    <div
      className="icon-picker-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleOverlayKeyDown}
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Icon picker"
    >
      <div className="icon-picker-modal">
        <div className="icon-picker-header">
          <span className="icon-picker-title">Choose Icon</span>
          <button className="icon-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="icon-picker-tabs" role="tablist">
          {(['emoji', 'lucide', 'user'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`icon-picker-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'emoji' ? 'Emoji' : t === 'lucide' ? 'Bundled' : 'My Packs'}
            </button>
          ))}
        </div>

        <div className="icon-picker-body">
          {tab === 'emoji' && (
            <div className="icon-picker-emoji-pane">
              <input
                className="icon-picker-search"
                placeholder="Paste or type an emoji…"
                value={emojiInput}
                onChange={(e) => setEmojiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && emojiInput.trim()) onSelect(emojiInput.trim());
                }}
                autoFocus
              />
              <div className="icon-picker-grid">
                {EMOJI_QUICK_PICKS.map((emoji) => (
                  <button
                    key={emoji}
                    className={`icon-picker-cell${currentIcon === emoji ? ' selected' : ''}`}
                    onClick={() => onSelect(emoji)}
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'lucide' && (
            <div className="icon-picker-lucide-pane">
              <input
                className="icon-picker-search"
                placeholder="Search icons…"
                value={lucideSearch}
                onChange={(e) => setLucideSearch(e.target.value)}
                autoFocus
              />
              <div className="icon-picker-grid">
                {filteredLucide.map((name) => {
                  const value = `pack:lucide/${name}`;
                  const Comp = LUCIDE_ICONS[name];
                  return (
                    <button
                      key={name}
                      className={`icon-picker-cell${currentIcon === value ? ' selected' : ''}`}
                      onClick={() => onSelect(value)}
                      title={name}
                    >
                      {Comp && <Comp size={18} strokeWidth={1.5} aria-hidden />}
                      <span className="icon-picker-label">{name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'user' && (
            <div className="icon-picker-user-pane">
              {userPacks.length === 0 ? (
                <div className="icon-picker-empty">
                  Drop SVG files into <code>~/Mythos/.icons/&lt;packname&gt;/</code> to add packs.
                </div>
              ) : (
                <>
                  <div className="icon-picker-pack-tabs">
                    {userPacks.map((p) => (
                      <button
                        key={p.packName}
                        className={`icon-picker-pack-tab${selectedPack === p.packName ? ' active' : ''}`}
                        onClick={() => setSelectedPack(p.packName)}
                      >
                        {p.packName}
                      </button>
                    ))}
                  </div>
                  {currentPack && (
                    <div className="icon-picker-grid">
                      {currentPack.icons.map((iconName) => {
                        const value = `pack:${currentPack.packName}/${iconName}`;
                        return (
                          <button
                            key={iconName}
                            className={`icon-picker-cell${currentIcon === value ? ' selected' : ''}`}
                            onClick={() => onSelect(value)}
                            title={iconName}
                          >
                            <NodeIcon icon={value} fallback="?" />
                            <span className="icon-picker-label">{iconName}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {currentIcon && (
          <div className="icon-picker-footer">
            <span className="icon-picker-current-label">Current:</span>
            <span className="icon-picker-current">
              <NodeIcon icon={currentIcon} fallback="—" />
            </span>
            <button className="icon-picker-clear" onClick={() => onSelect('')}>Remove icon</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default IconPicker;
