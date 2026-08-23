/* Modal + toast.
   Every edit in this app happens in a bottom sheet: it lands under the
   thumb, it doesn't lose your place in the list behind it, and it can't be
   dismissed by a stray tap on the scrim — which matters when you're doing
   this one-handed with the other hand still on the keys. */
(function (global) {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var active = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function optionTags(options, selected) {
    return options.map(function (o) {
      var value = typeof o === 'string' ? o : o.value;
      var label = typeof o === 'string' ? o : o.label;
      var sel = String(value) === String(selected == null ? '' : selected) ? ' selected' : '';
      return '<option value="' + esc(value) + '"' + sel + '>' + esc(label) + '</option>';
    }).join('');
  }

  function fieldHTML(f) {
    if (f.type === 'pair') {
      return '<div class="field__pair">' + f.fields.map(fieldHTML).join('') + '</div>';
    }

    var id = 'f_' + f.name;
    var label = '<span class="field__label">' + esc(f.label) + '</span>';
    var body;

    if (f.type === 'select') {
      body = '<select id="' + id + '" data-name="' + esc(f.name) + '">' +
        optionTags(f.options || [], f.value) + '</select>';
    } else if (f.type === 'textarea') {
      body = '<textarea id="' + id + '" data-name="' + esc(f.name) + '" rows="' + (f.rows || 4) +
        '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>';
    } else if (f.type === 'roles') {
      body = '<div class="roles" id="' + id + '" data-name="' + esc(f.name) + '"></div>' +
        '<button class="btn btn--ghost btn--block" type="button" data-addrole="' + esc(f.name) + '">Add a role</button>';
    } else {
      body = '<input id="' + id + '" data-name="' + esc(f.name) + '" type="' + (f.type || 'text') +
        '" value="' + esc(f.value == null ? '' : f.value) + '"' +
        (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') +
        ' placeholder="' + esc(f.placeholder || '') + '" autocomplete="off">';
    }

    return '<label class="field" for="' + id + '">' + label + body + '</label>';
  }

  function roleRow(host, roleOptions, value) {
    var row = document.createElement('div');
    row.className = 'rolerow';

    var sel = document.createElement('select');
    sel.innerHTML = optionTags(roleOptions, (value && value.role) || roleOptions[0]);
    sel.className = 'rolerow__role';

    var who = document.createElement('input');
    who.type = 'text';
    who.placeholder = 'Who';
    who.autocomplete = 'off';
    who.value = (value && value.person) || '';
    who.className = 'rolerow__who';

    var kill = document.createElement('button');
    kill.type = 'button';
    kill.textContent = '×';
    kill.setAttribute('aria-label', 'Remove this role');
    kill.onclick = function () { row.remove(); };

    row.appendChild(sel);
    row.appendChild(who);
    row.appendChild(kill);
    host.appendChild(row);
    return row;
  }

  function collect(spec) {
    var out = {};
    (function walk(fields) {
      fields.forEach(function (f) {
        if (f.type === 'pair') return walk(f.fields);
        var node = el('f_' + f.name);
        if (!node) return;
        if (f.type === 'roles') {
          out[f.name] = Array.prototype.map.call(node.querySelectorAll('.rolerow'), function (r) {
            return {
              role: r.querySelector('.rolerow__role').value,
              person: r.querySelector('.rolerow__who').value.trim()
            };
          }).filter(function (r) { return r.person; });
        } else {
          out[f.name] = node.value.trim ? node.value.trim() : node.value;
        }
      });
    })(spec);
    return out;
  }

  /* Keep --vvh / --vvtop in step with what is actually visible.

     The Android soft keyboard shrinks the VISUAL viewport and leaves the
     layout viewport alone. A bottom sheet sized off the layout viewport
     therefore keeps its full height when the keyboard opens and pushes its own
     Cancel/Save bar off the bottom of the screen — the sheet looks like it has
     no way to save, on exactly the screens (chart, arrangement) where the
     keyboard is always open. visualViewport is the only thing that reports
     this correctly. Browsers without it fall back to innerHeight, which is
     what the layout was assuming anyway, so nothing regresses. */
  function syncViewport() {
    var vv = global.visualViewport;
    var height = vv ? vv.height : global.innerHeight;
    var top = vv ? vv.offsetTop : 0;
    if (!height) return;
    var root = document.documentElement;
    root.style.setProperty('--vvh', height + 'px');
    root.style.setProperty('--vvtop', top + 'px');
  }

  if (global.visualViewport) {
    global.visualViewport.addEventListener('resize', syncViewport);
    global.visualViewport.addEventListener('scroll', syncViewport);
  }
  global.addEventListener('resize', syncViewport);
  syncViewport();

  /* silent=true skips the onClosed hook. The app uses that hook to keep the
     browser/hardware Back button in step with the sheet, and a close that was
     ITSELF caused by Back must not push another history change. */
  function close(silent) {
    el('modal').hidden = true;
    el('modalBody').innerHTML = '';
    active = null;
    if (!silent && global.UI && typeof global.UI.onClosed === 'function') global.UI.onClosed();
  }

  function open(opts) {
    var fields = opts.fields || [];
    // Hook fires before the sheet appears. app.js uses it to push a history
    // entry so Back closes the sheet instead of leaving the screen. It lives
    // here rather than at the call sites so confirm() is covered too.
    var wasOpen = !el('modal').hidden;
    if (!wasOpen && global.UI && typeof global.UI.onOpen === 'function') global.UI.onOpen();
    active = opts;

    el('modalTitle').textContent = opts.title || 'Edit';
    el('modalBody').innerHTML = fields.map(fieldHTML).join('') +
      (opts.extraHTML || '');
    el('modalSave').textContent = opts.saveLabel || 'Save';
    el('modalSave').className = 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary');
    el('modalCancel').textContent = opts.cancelLabel || 'Cancel';
    el('modal').hidden = false;

    // hydrate role widgets
    fields.forEach(function seed(f) {
      if (f.type === 'pair') return f.fields.forEach(seed);
      if (f.type !== 'roles') return;
      var host = el('f_' + f.name);
      (f.value || []).forEach(function (v) { roleRow(host, f.options, v); });
    });

    el('modalBody').querySelectorAll('[data-addrole]').forEach(function (btn) {
      btn.onclick = function () {
        var name = btn.getAttribute('data-addrole');
        var f = null;
        (function find(list) {
          list.forEach(function (x) {
            if (x.type === 'pair') return find(x.fields);
            if (x.name === name) f = x;
          });
        })(fields);
        var host = el('f_' + name);
        var row = roleRow(host, f.options, null);
        row.querySelector('.rolerow__who').focus();
      };
    });

    if (opts.onOpen) opts.onOpen(el('modalBody'));

    syncViewport();

    var first = el('modalBody').querySelector('input, select, textarea');
    if (first && opts.autofocus !== false) {
      setTimeout(function () {
        first.focus();
        // The keyboard animates in after focus, so re-measure once it has
        // settled and make sure the field it opened for is actually visible.
        setTimeout(function () {
          syncViewport();
          if (first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
        }, 260);
      }, 60);
    }
  }

  el('modalSave').addEventListener('click', function () {
    if (!active) return;
    var values = collect(active.fields || []);
    var result = active.onSave ? active.onSave(values) : true;
    Promise.resolve(result).then(function (ok) { if (ok !== false) close(); });
  });

  el('modalCancel').addEventListener('click', function () {
    if (active && active.onCancel) active.onCancel();
    close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el('modal').hidden) close();
  });

  var toastTimer = null;
  function toast(text) {
    var t = el('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function confirm(opts) {
    open({
      title: opts.title || 'Are you sure?',
      fields: [],
      extraHTML: '<p style="margin:0;font-size:16px">' + esc(opts.message || '') + '</p>',
      saveLabel: opts.confirmLabel || 'Delete',
      danger: true,
      autofocus: false,
      onSave: function () { opts.onConfirm(); return true; }
    });
  }

  global.UI = {
    open: open,
    close: close,
    closeSilent: function () { close(true); },
    isOpen: function () { return !el('modal').hidden; },
    toast: toast,
    confirm: confirm,
    esc: esc,
    onOpen: null,       // set by app.js
    onClosed: null      // set by app.js
  };
})(window);
