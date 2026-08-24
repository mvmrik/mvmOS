(function () {
  var config = globalThis.MVM_EXTENSION_CONFIG;
  var api = globalThis.browser || globalThis.chrome;
  var TEXTS = {
    en: {
      title: '{app} settings', subtitle: 'Choose which mvmOS installation loads the public page.',
      server: 'mvmOS URL', hint: 'The URL is filled automatically, but you can change it.',
      width: 'Extension width', widthHint: 'Between 300 and 800 pixels. Applied the next time the popup opens.',
      save: 'Save', saved: 'Saved',
      shortcut: 'Keyboard shortcuts', shortcutNone: 'not set',
      shortcutHint: 'Shortcuts are assigned by the browser itself, not by the extension. Its page for them is:',
      shortcutFirefox: 'Then: ⚙ → Manage Extension Shortcuts.',
      shortcutEdit: 'Change in the browser',
      shortcutManual: 'The browser does not allow that page to be opened from here. The address is on your clipboard — paste it into a new tab.'
    },
    bg: {
      title: 'Настройки на {app}', subtitle: 'Избери от коя mvmOS инсталация да се зарежда публичната страница.',
      server: 'mvmOS адрес', hint: 'Адресът е попълнен автоматично, но можеш да го промениш.',
      width: 'Ширина на разширението', widthHint: 'Между 300 и 800 пиксела. Промяната важи при следващото отваряне.',
      save: 'Запази', saved: 'Запазено',
      shortcut: 'Клавишни комбинации', shortcutNone: 'не е зададена',
      shortcutHint: 'Комбинациите се задават от самия браузър, а не от разширението. Страницата за тях е:',
      shortcutFirefox: 'После: ⚙ → Управление на клавишните комбинации.',
      shortcutEdit: 'Промени в браузъра',
      shortcutManual: 'Браузърът не позволява страницата да бъде отворена оттук. Адресът е копиран — постави го в нов таб.'
    },
    fr: {
      title: 'Paramètres de {app}', subtitle: 'Choisissez quelle installation mvmOS charge la page publique.',
      server: 'URL mvmOS', hint: "L'URL est renseignée automatiquement, mais vous pouvez la modifier.",
      width: "Largeur de l'extension", widthHint: 'Entre 300 et 800 pixels. Appliqué à la prochaine ouverture du popup.',
      save: 'Enregistrer', saved: 'Enregistré',
      shortcut: 'Raccourcis clavier', shortcutNone: 'non défini',
      shortcutHint: "Les raccourcis sont attribués par le navigateur lui-même, pas par l'extension. Sa page pour cela est :",
      shortcutFirefox: 'Puis : ⚙ → Gérer les raccourcis des extensions.',
      shortcutEdit: 'Modifier dans le navigateur',
      shortcutManual: "Le navigateur ne permet pas d'ouvrir cette page depuis ici. L'adresse a été copiée — collez-la dans un nouvel onglet."
    },
    es: {
      title: 'Ajustes de {app}', subtitle: 'Elige qué instalación de mvmOS carga la página pública.',
      server: 'URL de mvmOS', hint: 'La URL se completa automáticamente, pero puedes cambiarla.',
      width: 'Ancho de la extensión', widthHint: 'Entre 300 y 800 píxeles. Se aplica la próxima vez que se abra la ventana emergente.',
      save: 'Guardar', saved: 'Guardado',
      shortcut: 'Atajos de teclado', shortcutNone: 'no establecido',
      shortcutHint: 'Los atajos los asigna el propio navegador, no la extensión. Su página para esto es:',
      shortcutFirefox: 'Luego: ⚙ → Administrar atajos de extensiones.',
      shortcutEdit: 'Cambiar en el navegador',
      shortcutManual: 'El navegador no permite abrir esa página desde aquí. La dirección está en tu portapapeles — pégala en una pestaña nueva.'
    },
    de: {
      title: '{app}-Einstellungen', subtitle: 'Wählen Sie, welche mvmOS-Installation die öffentliche Seite lädt.',
      server: 'mvmOS-URL', hint: 'Die URL wird automatisch ausgefüllt, kann aber geändert werden.',
      width: 'Erweiterungsbreite', widthHint: 'Zwischen 300 und 800 Pixel. Wird beim nächsten Öffnen des Popups angewendet.',
      save: 'Speichern', saved: 'Gespeichert',
      shortcut: 'Tastenkombinationen', shortcutNone: 'nicht festgelegt',
      shortcutHint: 'Tastenkombinationen werden vom Browser selbst zugewiesen, nicht von der Erweiterung. Die zugehörige Seite:',
      shortcutFirefox: 'Dann: ⚙ → Erweiterungs-Tastenkombinationen verwalten.',
      shortcutEdit: 'Im Browser ändern',
      shortcutManual: 'Der Browser erlaubt es nicht, diese Seite von hier aus zu öffnen. Die Adresse wurde in die Zwischenablage kopiert — fügen Sie sie in einen neuen Tab ein.'
    },
    ru: {
      title: 'Настройки {app}', subtitle: 'Выберите, какая установка mvmOS загружает публичную страницу.',
      server: 'URL mvmOS', hint: 'URL заполняется автоматически, но вы можете изменить его.',
      width: 'Ширина расширения', widthHint: 'От 300 до 800 пикселей. Применяется при следующем открытии всплывающего окна.',
      save: 'Сохранить', saved: 'Сохранено',
      shortcut: 'Комбинации клавиш', shortcutNone: 'не задана',
      shortcutHint: 'Комбинации клавиш назначаются самим браузером, а не расширением. Страница для них:',
      shortcutFirefox: 'Затем: ⚙ → Управление комбинациями клавиш расширений.',
      shortcutEdit: 'Изменить в браузере',
      shortcutManual: 'Браузер не позволяет открыть эту страницу отсюда. Адрес скопирован в буфер обмена — вставьте его в новую вкладку.'
    },
    'zh-CN': {
      title: '{app} 设置', subtitle: '选择由哪个 mvmOS 安装加载公共页面。',
      server: 'mvmOS 地址', hint: '地址会自动填写，但你可以修改它。',
      width: '扩展宽度', widthHint: '介于 300 到 800 像素之间。将在下次打开弹出窗口时生效。',
      save: '保存', saved: '已保存',
      shortcut: '键盘快捷键', shortcutNone: '未设置',
      shortcutHint: '快捷键由浏览器本身分配，而非扩展程序。其设置页面是：',
      shortcutFirefox: '然后：⚙ → 管理扩展程序快捷键。',
      shortcutEdit: '在浏览器中修改',
      shortcutManual: '浏览器不允许从这里打开该页面。地址已复制到剪贴板 — 请粘贴到新标签页中。'
    },
    'pt-BR': {
      title: 'Configurações de {app}', subtitle: 'Escolha qual instalação do mvmOS carrega a página pública.',
      server: 'URL do mvmOS', hint: 'A URL é preenchida automaticamente, mas você pode alterá-la.',
      width: 'Largura da extensão', widthHint: 'Entre 300 e 800 pixels. Aplicado na próxima vez que o popup for aberto.',
      save: 'Salvar', saved: 'Salvo',
      shortcut: 'Atalhos de teclado', shortcutNone: 'não definido',
      shortcutHint: 'Os atalhos são atribuídos pelo próprio navegador, não pela extensão. A página para isso é:',
      shortcutFirefox: 'Depois: ⚙ → Gerenciar atalhos de extensões.',
      shortcutEdit: 'Alterar no navegador',
      shortcutManual: 'O navegador não permite abrir essa página a partir daqui. O endereço foi copiado para a área de transferência — cole-o em uma nova aba.'
    },
    ja: {
      title: '{app} の設定', subtitle: '公開ページを読み込む mvmOS インストールを選択してください。',
      server: 'mvmOS の URL', hint: 'URL は自動的に入力されますが、変更できます。',
      width: '拡張機能の幅', widthHint: '300～800 ピクセルの範囲。次回ポップアップを開いたときに適用されます。',
      save: '保存', saved: '保存しました',
      shortcut: 'キーボードショートカット', shortcutNone: '未設定',
      shortcutHint: 'ショートカットは拡張機能ではなくブラウザ自体によって割り当てられます。設定ページ：',
      shortcutFirefox: '次に：⚙ → 拡張機能のショートカットを管理。',
      shortcutEdit: 'ブラウザで変更',
      shortcutManual: 'ブラウザではこのページをここから開けません。アドレスはクリップボードにコピーされました — 新しいタブに貼り付けてください。'
    }
  };
  function detectLang() {
    var codes = Object.keys(TEXTS);
    var nl = (navigator.language || 'en').toLowerCase();
    for (var i = 0; i < codes.length; i++) if (nl === codes[i].toLowerCase()) return codes[i];
    var base = nl.split('-')[0];
    if (base === 'zh') return 'zh-CN';
    if (base === 'pt') return 'pt-BR';
    for (var j = 0; j < codes.length; j++) if (codes[j].toLowerCase().split('-')[0] === base) return codes[j];
    return 'en';
  }
  var lang = detectLang();
  var text = TEXTS[lang] || TEXTS.en;
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
