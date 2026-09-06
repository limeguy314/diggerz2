(function () {
  function board() {
    try {
      if (typeof q !== 'undefined' && q.GetChildByType && typeof Bd !== 'undefined')
        return q.GetChildByType(Bd);
    } catch (e) {}
    return null;
  }
  function u16(n) { n &= 0xffff; return [n & 255, (n >> 8) & 255]; }
  function i32(n) { n |= 0; return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
  function sendRaw(bytes) {
    try {
      var b = board();
      if (b && b.R36 && b.R36.A10 && b.R36.A11) {
        b.R36.A10.sendBytes(bytes);
        return true;
      }
    } catch (e) {}
    return false;
  }
  function adminCmd(obj) {
    var text = JSON.stringify(obj);
    var parts = [];
    parts.push.apply(parts, u16(250));
    var len = text.length + 1;
    parts.push.apply(parts, i32(len));
    for (var i = 0; i < text.length; i++) parts.push(text.charCodeAt(i) & 255);
    while (parts.length % 8) parts.push(0);
    return sendRaw(new Uint8Array(parts));
  }

  window.DiggerzOnlineAdmin = {
    _owner: false,
    _lime: false,
    adminPvpEnabled: false,
    adminAuthorizeOwner: function () { this._owner = true; return true; },
    adminAuthorizeLime: function () { this._lime = true; return true; },
    adminIsOwnerAuthorized: function () { return !!this._owner; },
    adminIsLimeAuthorized: function () { return !!this._lime; },
    adminIsAdminAuthorized: function () { return !!(this._owner || this._lime); },
    adminApplyOwnerTag: function () { return true; },
    adminApplyLimeTag: function () { return true; },
    adminApplyAdminTag: function () { return true; },
    adminApplyRoleTag: function () { return true; },
    adminWrongCodePenalty: function () {},
    adminSetPvp: function (enabled) {
      if (!this.adminIsAdminAuthorized()) return { ok: false, message: 'Admin authentication required.' };
      this.adminPvpEnabled = !!enabled;
      try { q.diggerzAdminPvpEnabled = this.adminPvpEnabled; } catch (e) {}
      adminCmd({ op: 'pvp', enabled: !!enabled });
      return { ok: true, message: 'PvP override ' + (enabled ? 'enabled' : 'disabled') };
    },
    adminCatalog: function (category) {
      category = category | 0;
      if (category !== 1 && category !== 2) return [];
      var out = [], max = category === 1 ? 700 : 450, id, display, name;
      for (id = 1; id <= max; id++) {
        try {
          display = new X(null, category, id, 0, 0, 1, 0, '', 0);
          name = String(display._1 || '').replace(/\x00/g, '');
          if (name && name !== 'undefined' && name.toLowerCase().indexOf('unused') < 0)
            out.push({ id: id, name: name, category: category });
        } catch (e) {}
      }
      return out;
    },
    adminPlayers: function () {
      var out = [];
      try {
        var b = board();
        if (b && b._9) {
          for (var i = 0; i < b._9.length; i++) {
            var entity = b._9[i];
            if (entity && entity._1 && typeof entity._1 === 'string' && entity.q7)
              out.push({ name: String(entity._1), local: typeof l !== 'undefined' && entity === l.z39 });
          }
        }
        if (!out.length && typeof l !== 'undefined' && l.z39)
          out.push({ name: String(l.z39._1 || 'Player'), local: true });
      } catch (e) {}
      if (!out.length) out.push({ name: 'Player', local: true });
      return out;
    },
    adminFindPlayer: function (name) {
      try {
        if (!name && typeof l !== 'undefined') return l.z39;
        var b = board();
        if (b && b._9) {
          for (var i = 0; i < b._9.length; i++) {
            var entity = b._9[i];
            if (entity && String(entity._1) === String(name)) return entity;
          }
        }
        if (typeof l !== 'undefined' && l.z39 && String(l.z39._1) === String(name)) return l.z39;
      } catch (e) {}
      return typeof l !== 'undefined' ? l.z39 : null;
    },
    adminSpawnItem: function (category, id, count) {
      if (!this.adminIsAdminAuthorized()) return { ok: false, message: 'Admin authentication required.' };
      category = category | 0; id = id | 0; count = Math.max(1, Math.min(999, count | 0));
      if ((category !== 1 && category !== 2) || id <= 0) return { ok: false, message: 'Invalid item.' };
      var ok = adminCmd({ op: 'give', category: category, id: id, count: count });
      return { ok: true, message: ok ? ('Gave item ' + id + ' x' + count) : 'Join the map first, then try again.' };
    },
    adminSpawnCoins: function (amount) {
      if (!this.adminIsAdminAuthorized()) return { ok: false, message: 'Admin authentication required.' };
      amount = Math.max(1, Math.min(1000000, amount | 0));
      var ok = adminCmd({ op: 'coins', amount: amount });
      return { ok: true, message: ok ? ('Added ' + amount + ' coins') : 'Join the map first, then try again.' };
    },
    adminKillPlayer: function (name) {
      if (!this.adminIsAdminAuthorized()) return { ok: false, message: 'Admin authentication required.' };
      var ok = adminCmd({ op: 'kill', name: String(name || '') });
      return { ok: true, message: ok ? ('Kill requested: ' + name) : 'Join the map first.' };
    },
    adminTeleportTo: function (name) {
      if (!this.adminIsAdminAuthorized()) return { ok: false, message: 'Admin authentication required.' };
      var ok = adminCmd({ op: 'tp', name: String(name || '') });
      return { ok: true, message: ok ? ('Teleport requested: ' + name) : 'Join the map first.' };
    }
  };

  var n = 0;
  var t = setInterval(function () {
    try {
      if (window.DiggerzOnlineAdmin && window.Main)
        window.Main.diggerzService = window.DiggerzOnlineAdmin;
    } catch (e) {}
    if (++n > 240) clearInterval(t);
  }, 250);
})();
