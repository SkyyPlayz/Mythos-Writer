/**
 * SKY-11186 — Settings → Editor → Notes Board.
 *
 * Owner ruling 4 (SKY-10724): the board's zoom-out cap is an ADJUSTABLE,
 * VISIBLE performance setting, not a silent constant. Spec §6 sets the
 * default at 40%; the lower stops let a large vault be surveyed as a map of
 * coloured blocks (LOD tier 3) at the cost of more cards mounted per screen.
 * The canvas's zoom-out button names this setting when it hits the floor.
 */
import { M24Card, M24Seg } from './M24Controls';
import './M24Sections.css';
import { ZOOM_MIN_OPTIONS, clampMinZoom, type ZoomMinOption } from '../../../pages/Boards/boardLod';

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

const ZOOM_MIN_LABELS: Record<ZoomMinOption, string> = {
  40: '40% · default',
  30: '30%',
  20: '20%',
  10: '10% · map view',
};

const OPTIONS = ZOOM_MIN_OPTIONS.map((v): [`${ZoomMinOption}`, string] => [`${v}`, ZOOM_MIN_LABELS[v]]);

export default function NotesBoardSection({ settings, setSettings, setSavedOk }: Props) {
  const minZoom = clampMinZoom(settings.notesBoard?.minZoom);

  return (
    <section className="settings-section m24-root" aria-labelledby="section-notes-board" data-settings-cat="editor">
      <h3 className="settings-section-title" id="section-notes-board">Notes Board</h3>

      <M24Card
        title="Zoom-out limit"
        sub="How far a board can zoom out. Lower limits show more of a large board at once and mount more cards per screen, which costs performance on very big folders."
      >
        <M24Seg
          options={OPTIONS}
          current={`${minZoom}`}
          ariaLabel="Zoom-out limit"
          testIdPrefix="notes-board-min-zoom"
          onPick={(k) => {
            const next = clampMinZoom(Number(k));
            setSettings((prev) => ({ ...prev, notesBoard: { ...prev.notesBoard, minZoom: next } }));
            setSavedOk(false);
          }}
        />
        <div style={{ fontSize: 10.5, color: '#7686a2', marginTop: 10, lineHeight: 1.5 }}>
          Past 68% cards drop their text preview, and past 44% they become coloured blocks — a map
          of the board. Zooming out further than 40% keeps that map but draws more of it at once.
        </div>
      </M24Card>
    </section>
  );
}
