// Keep the credential outside the travel records that are exported and synced.
class AtlasDeviceToken {
  constructor(db) {
    this.db = db;
    this.supported = Boolean(db && globalThis.crypto?.subtle);
  }

  transaction(mode, change) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('atlas', mode);
      const store = tx.objectStore('atlas');
      const read = store.get('github-device-token');
      let result;
      read.onsuccess = () => {
        try { result = change(store, read.result); }
        catch (error) { reject(error); tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('设备存储不可用。'));
    });
  }

  async load() {
    if (!this.supported) return null;
    const entry = await this.transaction('readonly', (_, value) => value);
    if (!entry) return null;
    const bytes = await crypto.subtle.decrypt({name:'AES-GCM', iv:entry.iv}, entry.key, entry.ciphertext);
    return {...JSON.parse(new TextDecoder().decode(bytes)), version:entry.version};
  }

  async save(api, meta) {
    const key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const version = crypto.randomUUID();
    const data = {token:api.token, owner:meta.owner.login, repo:meta.name, repoId:meta.id};
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(data)));
    return this.transaction('readwrite', store => {
      if (api.controller.signal.aborted) throw new Error('连接已断开。');
      store.put({key, iv, ciphertext, version}, 'github-device-token');
      return version;
    });
  }

  forget(version) {
    return this.transaction('readwrite', (store, entry) => {
      if (!entry || (version && version !== entry.version)) return false;
      store.delete('github-device-token');
      return entry.version;
    });
  }
}
