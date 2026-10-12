(() => {
  const H = "http://127.0.0.1:1431";
  let next = 1;
  const cbs = new Map();
  const listeners = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb) { const id = next++; cbs.set(id, cb); return id; },
    unregisterCallback(id) { cbs.delete(id); },
    async invoke(cmd, args) {
      if (cmd === "plugin:event|listen") {
        const id = next++;
        if (!listeners.has(args.event)) listeners.set(args.event, []);
        listeners.get(args.event).push({ id, handler: args.handler });
        return id;
      }
      if (cmd === "plugin:event|unlisten") {
        for (const [, l] of listeners) { const i = l.findIndex((x) => x.id === args.eventId); if (i > -1) l.splice(i, 1); }
        return null;
      }
      const res = await fetch(H, { method: "POST", body: JSON.stringify({ cmd, args }) });
      const o = await res.json();
      if (!o.ok) throw o.error;
      return o.value;
    },
  };
  const es = new EventSource(H + "/events");
  es.onmessage = (m) => {
    const { event, payload } = JSON.parse(m.data);
    for (const l of listeners.get(event) || []) cbs.get(l.handler)?.({ event, id: l.id, payload });
  };
})();
