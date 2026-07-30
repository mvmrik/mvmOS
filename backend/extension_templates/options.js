(function () {
  var config = globalThis.MVM_EXTENSION_CONFIG;
  var api = globalThis.browser || globalThis.chrome;
  var lang = navigator.language.toLowerCase().startsWith('bg') ? 'bg' : 'en';
  var text = lang === 'bg' ? {
    title: 'Настройки на {app}', subtitle: 'Избери от коя mvmOS инсталация да се зарежда публичната страница.',
    server: 'mvmOS адрес', hint: 'Адресът е попълнен автоматично, но можеш да го промениш.',
    width: 'Ширина на разширението', widthHint: 'Между 300 и 800 пиксела. Промяната важи при следващото отваряне.',
    save: 'Запази', saved: 'Запазено'
  } : {
    title: '{app} settings', subtitle: 'Choose which mvmOS installation loads the public page.',
    server: 'mvmOS URL', hint: 'The URL is filled automatically, but you can change it.',
    width: 'Extension width', widthHint: 'Between 300 and 800 pixels. Applied the next time the popup opens.',
    save: 'Save', saved: 'Saved'
  };
  var fields = {};
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

  (config.settings || []).forEach(function (setting) {
    var wrap = document.createElement('div');
    wrap.className = 'field' + (setting.type === 'boolean' ? ' check' : '');
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
    document.getElementById('custom-settings').appendChild(wrap);
    fields[setting.key] = input;
  });

  getStorage(defaults()).then(function (values) {
    document.getElementById('server-url').value = values.server_url || '';
    document.getElementById('extension-width').value = values.extension_width || config.surface.width;
    Object.keys(fields).forEach(function (key) {
      if (fields[key].type === 'checkbox') fields[key].checked = Boolean(values[key]);
      else fields[key].value = values[key] == null ? '' : values[key];
    });
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
