// Harness page for the artifacts engine specs. Not a Vite input and not packaged.
(function () {
  var CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";
  var history = [''];
  var index = 0;
  var iframe = document.getElementById('art');
  var note = document.getElementById('note');
  var status = document.getElementById('status');
  var themeAck = document.getElementById('theme-ack');

  function text() {
    return history[index] || '';
  }

  function show() {
    note.value = text();
  }

  function edit(next) {
    history.splice(index + 1);
    history.push(next);
    index = history.length - 1;
    show();
  }

  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + CSP + '"></head><body><p>artifact</p></body></html>';

  document.getElementById('bind').addEventListener('click', function () {
    var seed = window.__noteSeed || '';
    history = [seed];
    index = 0;
    show();
    status.textContent = 'bound';
  });

  document.getElementById('edit').addEventListener('click', function () {
    edit(text() + ' user');
    status.textContent = 'edited';
  });

  document.getElementById('write-back').addEventListener('click', function () {
    edit(text() + '\nfrom artifact');
    status.textContent = 'write-back';
  });

  document.getElementById('undo').addEventListener('click', function () {
    if (index > 0) index -= 1;
    show();
    status.textContent = 'undo';
  });

  document.getElementById('save').addEventListener('click', function () {
    window.__savedNote = text();
    status.textContent = 'saved';
  });

  document.getElementById('refresh').addEventListener('click', function () {
    var api = window.api && window.api.artifacts;
    if (!api) {
      status.textContent = 'no-api';
      return;
    }
    api.refresh({ artifactId: '4a1b0c2d-e3f4-4123-8abc-1234567890ab', outputTokens: 1, usage: { used: 0, cap: 10 }, proposal: 'proposal only' })
      .then(function (result) { status.textContent = JSON.stringify(result); });
  });

  document.getElementById('ipc-write').addEventListener('click', function () {
    var api = window.api && window.api.artifacts;
    if (!api) {
      status.textContent = 'no-api';
      return;
    }
    api.writeBack({
      type: 'edit',
      artifactId: '4a1b0c2d-e3f4-4123-8abc-1234567890ab',
      origin: 'user',
      text: 'should not land',
      kind: 'note',
      targetPath: 'entities/characters/Hero.md',
      boundSha256: '',
    }).then(function (result) { status.textContent = JSON.stringify(result); });
  });

  document.getElementById('theme').addEventListener('click', function () {
    var vars = { '--ink': '#112233' };
    document.documentElement.setAttribute('style', '--ink:#112233');
    if (iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'theme', vars: vars }, '*');
    status.textContent = 'theme';
  });

  function safeValue(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 80) return false;
    if (/[;{}]|url\s*\(|expression\s*\(/i.test(value)) return false;
    return /^(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|-?\d+(?:\.\d+)?(?:px|rem)|serif|sans-serif|monospace|inherit|Lora|Inter|Georgia|system-ui)$/.test(value);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== iframe.contentWindow) return;
    if (!event.data || event.data.type !== 'theme-ack') return;
    var vars = event.data.vars;
    if (!vars || typeof vars !== 'object') return;
    var keys = Object.keys(vars);
    for (var i = 0; i < keys.length; i += 1) {
      if (!/^--[a-z0-9-]+$/i.test(keys[i]) || !safeValue(vars[keys[i]])) return;
    }
    themeAck.textContent = JSON.stringify(vars);
  });
})();
