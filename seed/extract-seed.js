// Run this in the Chrome DevTools console with prototype/Mythos Writer design.dc.html open.
// It copies every seed pack (both worlds, all stories, notes, events, boards, timelines, graph,
// brainstorm library, agent seeds) plus theme presets to the clipboard as JSON.
// Save the clipboard as seed/packs.json in the repo.
(() => {
  const C = window.__dcRegistry[Object.keys(window.__dcRegistry)[0]].Logic;
  const inst = new C({});
  const strip = o => JSON.parse(JSON.stringify(o, (k, v) => typeof v === 'function' ? undefined : v));
  const packs = {};
  ['mythos', 'aether'].forEach(v => { const p = inst.packs[v]; packs[v] = strip({ world: p.world, axis: p.axis, months: p.months, ntab: p.ntab, ntabs: p.ntabs, vault: p.vault, noteVaults: p.noteVaults, notes: p.notes, flags: p.flags, chips: p.chips, prompts: p.prompts, agent: p.agent, graph: p.graph, tl: p.tl, bs: p.bs, bd: p.bd, stories: p.stories }); });
  const out = { packs, plotTemplates: inst.tlTpls, crafterDraftVeynn: inst._crafterDraft0, crafterVaultColsVeynn: inst._crafterVaultCols0, graphCategories: inst.gCats, themePresets: strip(inst.sets), appearanceDefaults: inst.apprDefaults, swatches: inst.swatches, vaultIconSet: inst.iconSet, iconColors: inst.iconColors, agentFiles: inst.agentFiles, agentChatSeeds: inst.state.waChats, agentNames: inst.state.agentNames, agentVaults: inst.state.agentVaults, tensionDefaults: inst.state.tlTension };
  const json = JSON.stringify(out, null, 2);
  if (typeof copy === 'function') copy(json);
  console.log('seed JSON ready (' + json.length + ' chars) — copied to clipboard');
  return out;
})();
