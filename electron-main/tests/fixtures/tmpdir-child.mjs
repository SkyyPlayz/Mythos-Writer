/**
 * Child process for tmpdir.spec.ts. Each mode is one case; the spec kills it
 * after 5s if it is still running.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { failRm, recordRm, restoreRm, rmCalls } from '../../test-utils/tmpdir.testhooks.mjs';

const mode = process.argv[2];

function rawRm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function setEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function say(line) {
  fs.writeSync(1, `${line}\n`);
}

/** Print a refusal's path and its exact error message so the spec can assert both. */
function sayRefusal(label, p, err) {
  say(`${label}-dir ${p}`);
  say(`${label}-msg ${err instanceof Error ? err.message : String(err)}`);
}

function recreateDifferentInode(p, remove) {
  const before = fs.lstatSync(p);
  remove(p);
  const burns = [];
  fs.mkdirSync(p);
  let st = fs.lstatSync(p);
  let spins = 0;
  while (st.dev === before.dev && st.ino === before.ino) {
    remove(p);
    burns.push(fs.mkdtempSync(path.join(os.tmpdir(), 'inode-burn-')));
    fs.mkdirSync(p);
    st = fs.lstatSync(p);
    spins += 1;
    if (spins > 2000) {
      throw new Error('could not obtain a new inode');
    }
  }
  return burns;
}

async function loadTmp() {
  return import('../../test-utils/tmpdir.mjs');
}

async function refusals() {
  const { makeTestTmp, removeRecorded, cleanupTestTmp } = await loadTmp();
  const setupRm = fs.rmSync.bind(fs);
  const wipe = (p) => setupRm(p, { recursive: true, force: true });
  recordRm();
  /** @type {string[]} */
  const later = [];
  const savedRun = process.env.MYTHOS_TEST_RUN_ID;
  const savedTmp = process.env.TMPDIR;

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-out-'));
  later.push(outside);
  const marker = path.join(outside, 'keep.txt');
  fs.writeFileSync(marker, 'ok');

  const dirA = makeTestTmp('refa');
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-tmp-'));
  later.push(other);
  process.env.TMPDIR = other;
  let aThrew = false;
  try {
    removeRecorded(dirA);
  } catch (err) {
    aThrew = true;
    sayRefusal('case-a', dirA, err);
  }
  setEnv('TMPDIR', savedTmp);
  console.log(`case-a ${aThrew && fs.existsSync(dirA) ? 'survived' : 'lost'}`);

  const dirB = makeTestTmp('refb');
  process.env.MYTHOS_TEST_RUN_ID = 'ffffffff';
  let bThrew = false;
  try {
    removeRecorded(dirB);
  } catch (err) {
    bThrew = true;
    sayRefusal('case-b', dirB, err);
  }
  setEnv('MYTHOS_TEST_RUN_ID', savedRun);
  console.log(`case-b ${bThrew && fs.existsSync(dirB) ? 'survived' : 'lost'}`);

  const dirC = makeTestTmp('refc');
  wipe(dirC);
  fs.symlinkSync(outside, dirC);
  let cThrew = false;
  try {
    removeRecorded(dirC);
  } catch (err) {
    cThrew = true;
    sayRefusal('case-c', dirC, err);
  }
  const targetOk = fs.existsSync(marker);
  console.log(`case-c ${cThrew && targetOk ? 'target-intact' : 'lost'}`);

  const unrecorded = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-unrec-'));
  later.push(unrecorded);
  let dThrew = false;
  try {
    removeRecorded(unrecorded);
  } catch (err) {
    dThrew = true;
    sayRefusal('case-d', unrecorded, err);
  }
  console.log(`case-d ${dThrew && fs.existsSync(unrecorded) ? 'survived' : 'lost'}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-parent-'));
  later.push(root);
  const inside = path.join(root, 'inside');
  const outsideParent = path.join(root, 'outside');
  fs.mkdirSync(inside);
  fs.mkdirSync(outsideParent);
  const link = path.join(root, 'tmplink');
  fs.symlinkSync(inside, link);
  process.env.TMPDIR = link;
  const dirE = makeTestTmp('refe');
  fs.unlinkSync(link);
  fs.symlinkSync(outsideParent, link);
  let eThrew = false;
  try {
    removeRecorded(dirE);
  } catch (err) {
    eThrew = true;
    sayRefusal('case-e', dirE, err);
  }
  console.log(`case-e ${eThrew && fs.existsSync(dirE) ? 'survived' : 'lost'}`);
  fs.unlinkSync(link);
  fs.symlinkSync(inside, link);
  setEnv('TMPDIR', savedTmp);

  const dirF = makeTestTmp('reff');
  later.push(...recreateDifferentInode(dirF, wipe));
  let fThrew = false;
  try {
    removeRecorded(dirF);
  } catch (err) {
    fThrew = true;
    sayRefusal('case-f', dirF, err);
  }
  console.log(`case-f ${fThrew && fs.existsSync(dirF) ? 'new-dir-survived' : 'lost'}`);

  console.log(`rm calls ${rmCalls()}`);
  restoreRm();
  try {
    cleanupTestTmp();
  } catch {
    // symlink / recreated inode / parent-link stay recorded; wipe below
  }
  wipe(dirC);
  wipe(dirF);
  for (const p of later) wipe(p);
}

async function main() {
  const { makeTestTmp, cleanupTestTmp } = await loadTmp();

  switch (mode) {
    case 'refusals':
      await refusals();
      return;
    case 'keep-failure': {
      const p = makeTestTmp('okeep');
      rawRm(p);
      const swallow = () => {
        try {
          cleanupTestTmp();
        } catch (err) {
          if (!testFailed) throw err;
        }
      };
      let testFailed = true;
      let escaped = false;
      try {
        swallow();
      } catch {
        escaped = true;
      }
      console.log(`kept ${escaped ? 'no' : 'yes'}`);
      testFailed = false;
      let propagated = false;
      try {
        swallow();
      } catch (err) {
        propagated = err instanceof AggregateError;
      }
      console.log(`propagated ${propagated ? 'aggregate' : 'no'}`);
      return;
    }
    case 'aggregate': {
      const a = makeTestTmp('agga');
      const b = makeTestTmp('aggb');
      rawRm(a);
      rawRm(b);
      try {
        cleanupTestTmp();
        console.log('aggregate 0');
      } catch (err) {
        const n = err instanceof AggregateError ? err.errors.length : 0;
        console.log(`aggregate ${n}`);
      }
      return;
    }
    case 'no-fallback': {
      const p = makeTestTmp('nofb');
      console.log(`dir ${p}`);
      return;
    }
    case 'fail-rm': {
      const p = makeTestTmp('failrm');
      console.log(`dir ${p}`);
      failRm();
      console.log('armed');
      return;
    }
    case 'r20': {
      makeTestTmp('r20');
      cleanupTestTmp();
      cleanupTestTmp();
      console.log('second cleanup ok');
      return;
    }
    case 'signal-wait': {
      makeTestTmp('q2');
      say('ready');
      setInterval(() => {}, 1000);
      return;
    }
    case 'q1': {
      let hits = 0;
      process.on('SIGTERM', () => {
        hits += 1;
        say(`pre-hits ${hits}`);
        if (hits > 1) process.exit(9);
        setTimeout(() => process.exit(7), 80);
      });
      makeTestTmp('q1');
      say('ready');
      setInterval(() => {}, 1000);
      return;
    }
    case 'q3': {
      // A no-op listener stays registered so the helper does not re-raise.
      process.on('SIGTERM', () => {});
      const origRm = fs.rmSync;
      let extra = true;
      fs.rmSync = function reenter(target, opts) {
        if (extra) {
          extra = false;
          process.emit('SIGTERM');
        }
        return origRm.call(fs, target, opts);
      };
      makeTestTmp('q3a');
      makeTestTmp('q3b');
      process.emit('SIGTERM');
      fs.rmSync = origRm;
      console.log('done');
      return;
    }
    case 'q4-symlink': {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'q4-out-'));
      fs.writeFileSync(path.join(outside, 'keep.txt'), 'ok');
      const p = makeTestTmp('q4s');
      rawRm(p);
      fs.symlinkSync(outside, p);
      console.log(`outside ${outside}`);
      console.log(`link ${p}`);
      return;
    }
    case 'q4-recreate': {
      const p = makeTestTmp('q4r');
      const burns = recreateDifferentInode(p, rawRm);
      fs.writeFileSync(path.join(p, 'new.txt'), 'new');
      for (const burned of burns) rawRm(burned);
      console.log(`dir ${p}`);
      return;
    }
    case 'not-a-dir': {
      // M3: the recorded directory was replaced by a regular file.
      const { removeRecorded } = await loadTmp();
      const p = makeTestTmp('m3');
      rawRm(p);
      fs.writeFileSync(p, 'not a dir');
      recordRm();
      try {
        removeRecorded(p);
        say('m3 removed');
      } catch (err) {
        sayRefusal('m3', p, err);
      }
      say(`m3 file-intact ${fs.readFileSync(p, 'utf8') === 'not a dir' ? 'yes' : 'no'}`);
      say(`rm calls ${rmCalls()}`);
      restoreRm();
      fs.unlinkSync(p);
      return;
    }
    case 'retry-after-failed-rm': {
      // M16: a failed delete keeps the record, so a later retry still removes it.
      const { removeRecorded } = await loadTmp();
      const p = makeTestTmp('m16');
      failRm();
      try {
        removeRecorded(p);
        say('first removed');
      } catch (err) {
        say(`first-msg ${err instanceof Error ? err.message : String(err)}`);
      }
      restoreRm();
      say(`exists-after-fail ${fs.existsSync(p) ? 'yes' : 'no'}`);
      try {
        removeRecorded(p);
        say('retry ok');
      } catch (err) {
        sayRefusal('retry', p, err);
      }
      say(`exists-after-retry ${fs.existsSync(p) ? 'yes' : 'no'}`);
      cleanupTestTmp();
      say('cleanup ok');
      return;
    }
    case 'dotdot': {
      // Literal ../ is refused both as a tmp name and as a path to remove.
      const { removeRecorded } = await loadTmp();
      try {
        makeTestTmp('../x');
        say('name accepted');
      } catch (err) {
        say(`name-msg ${err instanceof Error ? err.message : String(err)}`);
      }
      const p = makeTestTmp('dotdot');
      const sneaky = `${p}${path.sep}..${path.sep}${path.basename(p)}`;
      recordRm();
      try {
        removeRecorded(sneaky);
        say('sneaky removed');
      } catch (err) {
        sayRefusal('sneaky', sneaky, err);
      }
      say(`rm calls ${rmCalls()}`);
      restoreRm();
      say(`dotdot survived ${fs.existsSync(p) ? 'yes' : 'no'}`);
      removeRecorded(p);
      return;
    }
    case 'leak-wait': {
      const p = makeTestTmp('rkill');
      say(`ready ${p}`);
      setInterval(() => {}, 1000);
      return;
    }
    case 'print-id-and-leak': {
      const id = process.env.MYTHOS_TEST_RUN_ID;
      console.log(`child-id ${id}`);
      fs.mkdirSync(path.join(os.tmpdir(), `mythos-test-${id}-uleak`));
      return;
    }
    case 'exit-leak': {
      const id = process.env.MYTHOS_TEST_RUN_ID;
      const code = Number(process.argv[3]);
      if (process.argv[4] === 'leak') {
        fs.mkdirSync(path.join(os.tmpdir(), `mythos-test-${id}-exit-leak`));
      }
      process.exit(code);
      return;
    }
    default: {
      const never = mode;
      console.error(`unknown mode ${String(never)}`);
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
