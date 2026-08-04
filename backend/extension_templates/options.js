(function () {
  var config = globalThis.MVM_EXTENSION_CONFIG;
  var api = globalThis.browser || globalThis.chrome;
  var lang = navigator.language.toLowerCase().startsWith('bg') ? 'bg' : 'en';
  var text = lang === 'bg' ? {
    title: 'Настройки на {app}', subtitle: 'Избери от коя mvmOS инсталация да се зарежда публичната страница.',
    server: 'mvmOS адрес', hint: 'Адресът е попълнен автоматично, но можеш да го промениш.',
    width: 'Ширина на разширението', widthHint: 'Между 300 и 800 пиксела. Промяната важи при следващото отваряне.',
    save: 'Запази', saved: 'Запазено',
    shortcut: 'Клавишни комбинации', shortcutNone: 'не е зададена',
    shortcutHint: 'Комбинациите се задават от самия браузър, а не от разширението. Страницата за тях е:',
    shortcutFirefox: 'После: ⚙ → Управление на клавишните комбинации.',
    shortcutEdit: 'Промени в браузъра',
    shortcutManual: 'Браузърът не позволява страницата да бъде отворена оттук. Адресът е копиран — постави го в нов таб.'
  } : {
    title: '{app} settings', subtitle: 'Choose which mvmOS installation loads the public page.',
    server: 'mvmOS URL', hint: 'The URL is filled automatically, but you can change it.',
    width: 'Extension width', widthHint: 'Between 300 and 800 pixels. Applied the next time the popup opens.',
    save: 'Save', saved: 'Saved',
    shortcut: 'Keyboard shortcuts', shortcutNone: 'not set',
    shortcutHint: 'Shortcuts are assigned by the browser itself, not by the extension. Its page for them is:',
    shortcutFirefox: 'Then: ⚙ → Manage Extension Shortcuts.',
    shortcutEdit: 'Change in the browser',
    shortcutManual: 'The browser does not allow that page to be opened from here. The address is on your clipboard — paste it into a new tab.'
  };
  var fields = {}, wraps = {};
  function label(value) {
    return value && typeof value === 'object' ? (value[lang] || value.en || '') : String(value || '');
  }
  function defaults() {
    var values = {server_url: config.initialServer, extension_width: config.surface.width};
    (config.settings || []).forEach(function (setting) { values[setting.key] = setting.default; });
    return values;
  }
  function getStorage(values) {
    var result = api.storage.local.get(values);
    return result && typeof result.then === 'function' ? result :
      new Promise(function (resolve) { api.storage.local.get(values, resolve); });
  }
  function setStorage(values) {
    var result = api.storage.local.set(values);
    return result && typeof result.then === 'function' ? result :
      new Promise(function (resolve) { api.storage.local.set(values, resolve); });
  }

  document.getElementById('title').textContent = text.title.replace('{app}', config.appName);
  document.getElementById('subtitle').textContent = text.subtitle;
  document.getElementById('server-label').textContent = text.server;
  document.getElementById('server-hint').textContent = text.hint;
  document.getElementById('width-label').textContent = text.width;
  document.getElementById('width-hint').textContent = text.widthHint;
  document.getElementById('save').textContent = text.save;

  // A setting may declare `show_if: {key, value}` — it is then rendered as a
  // sub-setting of the field it names and only shown while that field holds the
  // value. It is still saved either way: a hidden question keeps its answer, so
  // going back to the option it belongs to finds the choice as it was left.
  function shouldShow(setting) {
    var rule = setting.show_if;
    if (!rule || !rule.key || !fields[rule.key]) return true;
    var control = fields[rule.key];
    var current = control.type === 'checkbox' ? control.checked : control.value;
    var wanted = Object.prototype.hasOwnProperty.call(rule, 'value') ? rule.value : true;
    return Array.isArray(wanted) ? wanted.indexOf(current) >= 0 : current === wanted;
  }
  function refresh() {
    (config.settings || []).forEach(function (setting) {
      if (wraps[setting.key]) wraps[setting.key].hidden = !shouldShow(setting);
    });
  }

  (config.settings || []).forEach(function (setting) {
    var wrap = document.createElement('div');
    wrap.className = 'field' + (setting.type === 'boolean' ? ' check' : '') + (setting.show_if ? ' sub-field' : '');
    var input = setting.type === 'select' ? document.createElement('select') : document.createElement('input');
    input.id = 'setting-' + setting.key;
    if (setting.type === 'select') {
      (setting.options || []).forEach(function (option) {
        var item = document.createElement('option');
        item.value = option.value;
        item.textContent = label(option.label);
        input.appendChild(item);
      });
    } else {
      input.type = setting.type === 'boolean' ? 'checkbox' : 'text';
    }
    var fieldLabel = document.createElement('label');
    fieldLabel.htmlFor = input.id;
    fieldLabel.textContent = label(setting.label);
    if (setting.type === 'boolean') wrap.append(input, fieldLabel);
    else wrap.append(fieldLabel, input);
    input.addEventListener('change', refresh);
    document.getElementById('custom-settings').appendChild(wrap);
    fields[setting.key] = input;
    wraps[setting.key] = wrap;
  });

  getStorage(defaults()).then(function (values) {
    document.getElementById('server-url').value = values.server_url || '';
    document.getElementById('extension-width').value = values.extension_width || config.surface.width;
    Object.keys(fields).forEach(function (key) {
      if (fields[key].type === 'checkbox') fields[key].checked = Boolean(values[key]);
      else fields[key].value = values[key] == null ? '' : values[key];
    });
    refresh();
  });

  // The shortcut is the browser's to assign, not the extension's: there is no
  // API to set one, and in Chrome not even a way to link to the page that does.
  // So it is read back and shown — a shortcut nobody can see is a shortcut
  // nobody uses — with a button that opens that page as a tab.
  function shortcutUrl() {
    return config.browser === 'firefox' ? 'about:addons' : 'chrome://extensions/shortcuts';
  }
  function commands() {
    if (!api.commands || !api.commands.getAll) return Promise.resolve([]);
    var result = api.commands.getAll();
    return result && typeof result.then === 'function' ? result :
      new Promise(function (resolve) { api.commands.getAll(resolve); });
  }
  commands().then(function (list) {
    if (!list || !list.length) return;
    document.getElementById('shortcut-label').textContent = text.shortcut;
    document.getElementById('shortcut-hint').textContent = text.shortcutHint;
    document.getElementById('shortcut-address').textContent = shortcutUrl();
    if (config.browser === 'firefox') document.getElementById('shortcut-note').textContent = text.shortcutFirefox;
    document.getElementById('shortcut-edit').textContent = text.shortcutEdit;
    var box = document.getElementById('shortcut-list');
    list.forEach(function (command) {
      var row = document.createElement('div');
      row.className = 'shortcut';
      var name = document.createElement('span');
      name.textContent = command.description || command.name;
      var key = document.createElement(command.shortcut ? 'kbd' : 'span');
      key.textContent = command.shortcut || text.shortcutNone;
      row.append(name, key);
      box.appendChild(row);
    });
    document.getElementById('shortcuts').hidden = false;
  });
  // Opening that page is not something an extension is always allowed to do.
  // Chrome accepts chrome://extensions/shortcuts from tabs.create; Firefox
  // refuses about: pages outright, and the failure is silent — a rejected
  // promise in one browser, a thrown Error in another, nothing on screen in
  // both. So the address is always printed next to the button, the button only
  // tries, and anything that goes wrong falls back to putting the address on
  // the clipboard. A button that cannot work is worse than no button; one that
  // hands you the address always works.
  function manual(message) {
    var note = document.getElementById('shortcut-note');
    note.textContent = message;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shortcutUrl()).catch(function () {});
  }
  document.getElementById('shortcut-edit').addEventListener('click', function () {
    if (!api.tabs || !api.tabs.create) return manual(text.shortcutManual);
    try {
      var opened = api.tabs.create({url: shortcutUrl()});
      if (opened && typeof opened.catch === 'function') opened.catch(function () { manual(text.shortcutManual); });
      else if (api.runtime && api.runtime.lastError) manual(text.shortcutManual);
    } catch (_) {
      manual(text.shortcutManual);
    }
  });

  document.getElementById('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var server;
    try {
      server = new URL(document.getElementById('server-url').value.trim());
      if (!['http:', 'https:'].includes(server.protocol)) throw new Error();
    } catch (_) {
      document.getElementById('server-url').focus();
      return;
    }
    var width = Number(document.getElementById('extension-width').value);
    if (!Number.isFinite(width) || width < 300 || width > 800) {
      document.getElementById('extension-width').focus();
      return;
    }
    var values = {server_url: server.origin, extension_width: Math.round(width)};
    Object.keys(fields).forEach(function (key) {
      values[key] = fields[key].type === 'checkbox' ? fields[key].checked : fields[key].value;
    });
    setStorage(values).then(function () {
      var saved = document.getElementById('saved');
      saved.textContent = text.saved;
      setTimeout(function () { saved.textContent = ''; }, 1600);
    });
  });
})();
