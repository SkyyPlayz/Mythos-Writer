/**
 * SKY-11186 — Settings → Editor → Notes Board.
 *
 * Owner ruling 4 (SKY-10724): the board's zoom-out cap is an ADJUSTABLE,
 * VISIBLE performance setting, not a silent constant. Spec §6 sets the
 * default at 40%; the lower stops let a large vault be surveyed as a map of
 * coloured blocks (LOD tier 3) at the cost of more cards mounted per screen.
 * The canvas's zoom-out button names this setting when it hits the floor.
 */
import { M24Card, M24Seg, M24Toggle } from './M24Controls';
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

      {/*
        SKY-11192 (COMPANY-STANDARDS §3a) — off by default.

        This replaces a page the user already has, so it ships dark and stays
        dark until QA has signed off on the round-trip edit. Flag OFF is the
        legacy free-form idea canvas, unchanged. Flag ON points Brainstorm's
        Board page and its chat strip at the same vault folders this tab shows,
        and turns Idea Collections' `+` into a `File` that writes a real note.

        Turning it on also runs a one-time migration of the old board's cards
        into notes. That is why the copy says so plainly: it is a one-way door
        for the DATA (the ideas become notes and stay notes), even though the
        flag itself can be switched back.
      */}
      <M24Card
        title="Unified Brainstorm board (preview)"
        sub="Show the Brainstorm tab's board as the same canvas you see here, over your real Plot & Story, Characters and Worldbuilding folders. Editing from either place changes the same notes. Turning this on moves any ideas from the old Brainstorm board into notes, once."
      >
        <M24Toggle
          on={settings.notesBoard?.brainstormUnified ?? false}
          label="Use the unified board in Brainstorm"
          testId="notes-board-brainstorm-unified"
          onClick={() => {
            setSettings((prev) => ({
              ...prev,
              notesBoard: {
                ...prev.notesBoard,
                brainstormUnified: !(prev.notesBoard?.brainstormUnified ?? false),
              },
            }));
            setSavedOk(false);
          }}
        />
      </M24Card>
    </section>
  );
}
