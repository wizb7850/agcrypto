// Page de paiement autonome : HTML + CSS + JS sans framework, servie par l'API.
// Les données arrivent en JSON et sont insérées via textContent (aucune injection HTML possible).

export function renderCheckoutPage(invoiceId: string, nonce: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Paiement sécurisé</title>
<style>
  :root { --bg:#f4f5f7; --card:#fff; --text:#111827; --muted:#6b7280; --border:#e5e7eb;
          --accent:#4f46e5; --accent-soft:#eef2ff; --ok:#059669; --warn:#d97706; --err:#dc2626; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0f17; --card:#131a26; --text:#f3f4f6; --muted:#9ca3af; --border:#243042;
            --accent:#818cf8; --accent-soft:#1e2340; }
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:16px; }
  .card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
  header { padding:20px 24px; border-bottom:1px solid var(--border); }
  .merchant { font-size:13px; color:var(--muted); }
  .total { font-size:28px; font-weight:700; margin-top:2px; }
  .desc { color:var(--muted); font-size:14px; }
  main { padding:20px 24px; }
  h2 { font-size:15px; margin:0 0 12px; }
  .list { display:grid; gap:8px; }
  .opt { display:flex; justify-content:space-between; align-items:center; width:100%; padding:12px 14px;
         border:1px solid var(--border); border-radius:10px; background:transparent; color:inherit; font:inherit; cursor:pointer; text-align:left; }
  .opt:hover, .opt:focus-visible { border-color:var(--accent); background:var(--accent-soft); outline:none; }
  .net { font-size:12px; color:var(--muted); }
  .qr { display:flex; justify-content:center; margin:4px 0 16px; }
  .qr svg { width:180px; height:180px; background:#fff; border-radius:8px; padding:6px; }
  .field { margin-bottom:12px; }
  .label { font-size:12px; color:var(--muted); margin-bottom:4px; }
  .copy { display:flex; gap:8px; align-items:center; border:1px solid var(--border); border-radius:10px; padding:10px 12px; }
  .copy code { flex:1; word-break:break-all; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; }
  .copy button { border:0; background:var(--accent-soft); color:var(--accent); border-radius:6px; padding:6px 10px; font:inherit; font-size:13px; cursor:pointer; }
  .alert { font-size:13px; border-radius:10px; padding:10px 12px; margin:12px 0; background:var(--accent-soft); }
  .alert.warn { color:var(--warn); } .alert.err { color:var(--err); }
  .status { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--muted); }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--warn); animation:pulse 1.4s infinite; }
  @keyframes pulse { 50% { opacity:.3; } }
  .done { text-align:center; padding:12px 0; }
  .done .big { font-size:44px; }
  .link { background:none; border:0; color:var(--accent); font:inherit; cursor:pointer; padding:0; margin-top:12px; }
  footer { padding:12px 24px; border-top:1px solid var(--border); font-size:12px; color:var(--muted); display:flex; justify-content:space-between; }
</style>
</head>
<body>
<div class="card">
  <header>
    <div class="merchant" id="merchant"></div>
    <div class="total" id="total"></div>
    <div class="desc" id="desc"></div>
  </header>
  <main id="main"><div class="status"><span class="dot"></span>Chargement…</div></main>
  <footer><span>🔒 Paiement sécurisé</span><span id="timer"></span></footer>
</div>
<script nonce="${nonce}">
(() => {
  const ID = ${JSON.stringify(invoiceId)};
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  let data = null, choosing = false, pollTimer = null;

  async function load() {
    const res = await fetch('/pay/' + ID + '/data');
    if (!res.ok) return showError('Paiement introuvable.');
    data = await res.json();
    render();
  }

  function showError(msg) { $('main').replaceChildren(el('div', { className: 'alert err', textContent: msg })); }

  function copyField(label, value) {
    const btn = el('button', { type: 'button', textContent: 'Copier' });
    btn.onclick = async () => { await navigator.clipboard.writeText(value); btn.textContent = 'Copié ✓'; setTimeout(() => btn.textContent = 'Copier', 1500); };
    return el('div', { className: 'field' }, el('div', { className: 'label', textContent: label }),
      el('div', { className: 'copy' }, el('code', { textContent: value }), btn));
  }

  function render() {
    $('merchant').textContent = data.merchant;
    $('total').textContent = data.amount + ' ' + data.currency;
    $('desc').textContent = data.description || '';
    const p = data.payment;
    const main = $('main');

    if (data.status === 'paid') {
      stopPolling();
      main.replaceChildren(el('div', { className: 'done' }, el('div', { className: 'big', textContent: '✅' }),
        el('h2', { textContent: 'Paiement reçu, merci !' })));
      if (data.success_url) setTimeout(() => location.href = data.success_url, 2500);
      return;
    }
    if (data.status === 'expired' || data.status === 'failed') {
      stopPolling();
      main.replaceChildren(el('div', { className: 'alert err', textContent: data.status === 'expired'
        ? 'Ce paiement a expiré. Retournez sur le site du marchand pour recommencer.'
        : 'Le paiement a échoué. Contactez le marchand.' }));
      return;
    }
    if (data.status === 'partially_paid' && p) {
      main.replaceChildren(el('div', { className: 'alert warn', textContent:
        'Montant insuffisant : ' + p.actually_paid + ' ' + p.label + ' reçu sur ' + p.pay_amount + '. Contactez le marchand.' }));
      return;
    }
    if (data.status === 'confirming') {
      startPolling();
      main.replaceChildren(el('div', { className: 'done' }, el('div', { className: 'big', textContent: '⏳' }),
        el('h2', { textContent: 'Paiement détecté' }),
        el('div', { className: 'status' }, el('span', { className: 'dot' }), 'Confirmation sur la blockchain en cours…')));
      return;
    }
    if (p && !choosing) return renderPayment(p);
    renderChoice();
  }

  function renderChoice() {
    stopPolling();
    const list = el('div', { className: 'list' });
    for (const c of data.currencies) {
      const b = el('button', { type: 'button', className: 'opt' },
        el('span', {}, el('strong', { textContent: c.name }), el('div', { className: 'net', textContent: c.network })), '›');
      b.onclick = () => choose(c.code, b);
      list.append(b);
    }
    $('main').replaceChildren(el('h2', { textContent: 'Choisissez votre crypto' }), list);
  }

  async function choose(code, btn) {
    btn.disabled = true; btn.lastChild.textContent = '…';
    const res = await fetch('/pay/' + ID + '/payment', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pay_currency: code }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { btn.disabled = false; btn.lastChild.textContent = '›'; return alert(body.message || 'Erreur, réessayez.'); }
    choosing = false;
    data.payment = body;
    render();
  }

  function renderPayment(p) {
    startPolling();
    const qr = el('div', { className: 'qr' });
    qr.innerHTML = p.qr_svg; // SVG généré côté serveur par la librairie qrcode
    const change = el('button', { type: 'button', className: 'link', textContent: '← Choisir une autre crypto' });
    change.onclick = () => { choosing = true; render(); };
    $('main').replaceChildren(...[
      el('h2', { textContent: 'Envoyez exactement' }),
      qr,
      copyField('Montant (' + p.label + ')', p.pay_amount),
      copyField('Adresse ' + p.label + ' — réseau ' + p.network, p.pay_address),
      p.pay_extra_id ? copyField('Memo / Tag (obligatoire)', p.pay_extra_id) : null,
      el('div', { className: 'alert warn', textContent: '⚠️ Utilisez uniquement le réseau ' + p.network + '. Un envoi sur un autre réseau est perdu.' }),
      el('div', { className: 'status' }, el('span', { className: 'dot' }), 'En attente du paiement…'),
      change,
    ].filter(Boolean));
  }

  function startPolling() { if (!pollTimer) pollTimer = setInterval(load, 5000); }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  setInterval(() => {
    if (!data) return;
    const ms = new Date(data.expires_at) - Date.now();
    $('timer').textContent = ms > 0 && data.status === 'pending'
      ? 'Expire dans ' + Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') : '';
  }, 1000);

  load();
})();
</script>
</body>
</html>`;
}
