// Pannello per aggiungere o modificare: spese, entrate e operazioni di investimento.
import {
  state, categoriesOf, saveTransaction, deleteTransaction, todayISO,
  guessCategory, learnRule, saveAsset, saveOp, deleteOp, assetById, ASSET_TYPES
} from '../model.js';
import {
  h, openSheet, segmented, field, toast, confirmDialog, pickFile,
  parseEuro, parseDecimal, centsToInput, decToInput, eurD
} from '../ui.js';
import { recognize, parseReceipt, thumbnail } from '../scan.js';

/**
 * opts: { kind: 'spesa'|'entrata'|'investimento', tx?: movimento da modificare, op?: operazione da modificare, assetId? }
 */
export function openEditor(ctx, opts = {}) {
  let mode = opts.op ? 'investimento' : opts.kind || 'spesa';
  const editingTx = opts.tx || null;
  const editingOp = opts.op || null;

  const titleFor = () =>
    editingTx ? 'Modifica movimento' : editingOp ? 'Modifica operazione' : 'Nuovo movimento';

  openSheet(({ close, render, setTitle }) => {
    setTitle(titleFor());
    const wrap = h('div', { class: 'editor' });
    if (!editingOp) {
      const choices = editingTx
        ? [['spesa', 'Spesa'], ['entrata', 'Entrata']]
        : [['spesa', 'Spesa'], ['entrata', 'Entrata'], ['investimento', 'Investimento']];
      wrap.append(segmented(choices, mode, (v) => { mode = v; render(); }, 'big'));
    }
    if (mode === 'investimento') wrap.append(investmentForm(ctx, close, editingOp, opts.assetId));
    else wrap.append(transactionForm(ctx, close, mode, editingTx));
    return wrap;
  }, { title: titleFor() });
}

// ================= Spese ed entrate =================

function transactionForm(ctx, close, kind, tx) {
  const form = {
    amount: tx ? centsToInput(tx.amount) : '',
    note: tx?.note || '',
    date: tx?.date || todayISO(),
    accountId: tx?.accountId || state.accounts[0]?.id,
    categoryId: tx && tx.kind === kind ? tx.categoryId : null,
    photo: tx?.photo || null,
    manual: !!tx // se modifico, la categoria è già una scelta mia
  };
  let suggestion = null;
  let ocrText = '';

  const amountInput = h('input', {
    class: 'input amount', inputmode: 'decimal', placeholder: '0,00', value: form.amount, autocomplete: 'off',
    oninput: (e) => (form.amount = e.target.value)
  });
  const noteInput = h('input', {
    class: 'input', placeholder: kind === 'spesa' ? 'Es. Esselunga, Netflix…' : 'Es. Stipendio ottobre', value: form.note,
    oninput: (e) => {
      form.note = e.target.value;
      if (!form.manual) {
        suggestion = guessCategory({ merchant: form.note, text: ocrText }, kind);
        form.categoryId = suggestion?.categoryId || null;
        renderChips();
      }
    }
  });
  const dateInput = h('input', { class: 'input', type: 'date', value: form.date, max: todayISO(), onchange: (e) => (form.date = e.target.value) });
  const accountSelect = h('select', { class: 'input select', onchange: (e) => (form.accountId = e.target.value) },
    state.accounts.map((a) => h('option', { value: a.id, selected: a.id === form.accountId }, a.name)));

  // --- Categorie a "chip"
  const chips = h('div', { class: 'chips' });
  const suggestionNote = h('p', { class: 'hint suggestion' });
  function renderChips() {
    chips.replaceChildren(...categoriesOf(kind).map((c) =>
      h('button', {
        type: 'button',
        class: 'cat-chip' + (c.id === form.categoryId ? ' active' : ''),
        style: { '--c': c.color },
        onclick: () => { form.categoryId = c.id; form.manual = true; suggestion = null; renderChips(); }
      }, h('span', {}, c.emoji), c.name)
    ));
    suggestionNote.textContent = suggestion && form.categoryId
      ? `✨ Categoria suggerita (${suggestion.source}). Tocca un'altra per cambiarla.`
      : '';
  }
  renderChips();

  // --- Foto
  const photoBox = h('div', { class: 'photo-box' });
  function renderPhoto() {
    if (!form.photo) { photoBox.replaceChildren(); return; }
    const url = URL.createObjectURL(form.photo);
    photoBox.replaceChildren(
      h('img', { src: url, alt: 'Scontrino', onclick: () => openPhoto(form.photo) }),
      h('button', { type: 'button', class: 'link small', onclick: () => { form.photo = null; renderPhoto(); } }, 'Rimuovi foto')
    );
  }
  renderPhoto();

  // --- Scansione (solo spese)
  const scanStatus = h('div', { class: 'scan-status' });
  const pasteArea = h('textarea', { class: 'input', rows: 5, placeholder: 'Incolla qui il testo dello scontrino o della notifica della banca…' });
  const pasteBox = h('div', { class: 'paste-box hidden' },
    pasteArea,
    h('button', { type: 'button', class: 'btn ghost full', onclick: () => applyText(pasteArea.value, 'testo incollato') }, 'Analizza testo')
  );

  function applyText(text, origin) {
    ocrText = text;
    const r = parseReceipt(text);
    const found = [];
    if (r.amount) { form.amount = centsToInput(r.amount); amountInput.value = form.amount; found.push('importo'); }
    if (r.date) { form.date = r.date; dateInput.value = r.date; found.push('data'); }
    if (r.merchant) { form.note = r.merchant; noteInput.value = r.merchant; found.push('esercente'); }
    suggestion = guessCategory({ merchant: form.note, text }, 'spesa');
    if (suggestion) { form.categoryId = suggestion.categoryId; form.manual = false; found.push('categoria'); }
    renderChips();
    scanStatus.replaceChildren(
      h('p', { class: found.includes('importo') ? 'ok' : 'warn' },
        found.length ? `Dal ${origin} ho trovato: ${found.join(', ')}. Controlla e salva.` : 'Non sono riuscito a leggere i dati: compilali a mano.'),
      h('details', {}, h('summary', {}, 'Testo letto'), h('pre', {}, text || '(vuoto)'))
    );
  }

  async function scanPhoto() {
    const file = await pickFile('image/*');
    if (!file) return;
    form.photo = await thumbnail(file).catch(() => null);
    renderPhoto();
    const bar = h('div', { class: 'progress' }, h('i'));
    const label = h('span', {}, 'Avvio…');
    scanStatus.replaceChildren(h('div', { class: 'scanning' }, label, bar));
    try {
      const text = await recognize(file, (p, msg) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; label.textContent = msg; });
      applyText(text, 'la foto');
    } catch (e) {
      scanStatus.replaceChildren(h('p', { class: 'warn' }, e.message || 'Lettura non riuscita.'));
    }
  }

  const scanTools = kind === 'spesa' && !tx ? h('div', { class: 'scan-tools' },
    h('button', { type: 'button', class: 'scan-btn', onclick: scanPhoto },
      h('span', { class: 'scan-ico' }, '📷'), h('span', {}, h('strong', {}, 'Scansiona'), h('small', {}, 'foto scontrino o screenshot'))),
    h('button', { type: 'button', class: 'scan-btn alt', onclick: () => pasteBox.classList.toggle('hidden') },
      h('span', { class: 'scan-ico' }, '📋'), h('span', {}, h('strong', {}, 'Incolla testo'), h('small', {}, 'copiato da foto o notifica'))),
    pasteBox,
    scanStatus
  ) : null;

  const attachBtn = kind === 'spesa' && tx ? h('button', {
    type: 'button', class: 'link small',
    onclick: async () => { const f = await pickFile('image/*'); if (f) { form.photo = await thumbnail(f); renderPhoto(); } }
  }, form.photo ? 'Sostituisci foto' : 'Allega foto') : null;

  async function submit() {
    const cents = parseEuro(form.amount);
    if (!(cents > 0)) return toast('Inserisci un importo valido', 'error');
    if (!form.categoryId) return toast('Scegli una categoria', 'error');
    await saveTransaction({
      ...(tx || {}),
      kind,
      amount: cents,
      note: form.note.trim(),
      date: form.date || todayISO(),
      categoryId: form.categoryId,
      accountId: form.accountId,
      photo: form.photo || null
    });
    if (form.note.trim()) await learnRule(form.note, form.categoryId);
    toast(tx ? 'Movimento aggiornato' : kind === 'spesa' ? 'Spesa salvata' : 'Entrata salvata');
    close();
    ctx.refresh();
  }

  return h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); submit(); } },
    scanTools,
    h('label', { class: 'amount-field ' + kind }, h('span', { class: 'currency' }, '€'), amountInput),
    field(kind === 'spesa' ? 'Descrizione / esercente' : 'Descrizione', noteInput),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Categoria'), chips, suggestionNote),
    h('div', { class: 'row gap' }, field('Data', dateInput), field('Conto', accountSelect)),
    photoBox,
    attachBtn,
    h('div', { class: 'form-actions' },
      tx ? h('button', {
        type: 'button', class: 'btn danger ghost',
        onclick: async () => {
          if (!(await confirmDialog('Eliminare questo movimento?', { ok: 'Elimina', danger: true }))) return;
          await deleteTransaction(tx.id); toast('Movimento eliminato'); close(); ctx.refresh();
        }
      }, 'Elimina') : null,
      h('button', { type: 'submit', class: 'btn primary grow' }, 'Salva')
    )
  );
}

function openPhoto(blob) {
  const url = URL.createObjectURL(blob);
  openSheet(() => h('img', { class: 'photo-full', src: url, alt: 'Scontrino' }), { title: 'Foto' });
}

// ================= Investimenti =================

function investmentForm(ctx, close, op, presetAssetId) {
  const NEW = '__new__';
  const form = {
    assetId: op?.assetId || presetAssetId || state.assets[0]?.id || NEW,
    newName: '', newType: 'ETF',
    kind: op?.kind || 'acquisto',
    date: op?.date || todayISO(),
    qty: op ? decToInput(op.qty) : '',
    price: op ? decToInput(op.price) : '',
    fees: op ? decToInput(op.fees || 0) : '',
    amount: op ? decToInput(op.amount) : '',
    accountId: op ? op.accountId || '' : state.accounts[0]?.id || '',
    note: op?.note || ''
  };

  const body = h('div');
  const total = h('p', { class: 'total-line' });

  function updateTotal() {
    const fees = parseDecimal(form.fees) || 0;
    if (form.kind === 'dividendo') {
      const a = parseDecimal(form.amount) || 0;
      total.textContent = `Netto incassato: ${eurD(a - fees)}`;
    } else {
      const q = parseDecimal(form.qty) || 0, p = parseDecimal(form.price) || 0;
      const t = form.kind === 'acquisto' ? q * p + fees : q * p - fees;
      total.textContent = form.kind === 'acquisto' ? `Totale speso: ${eurD(t)}` : `Totale incassato: ${eurD(t)}`;
    }
  }

  const input = (key, attrs = {}) => h('input', {
    class: 'input', inputmode: 'decimal', value: form[key], autocomplete: 'off',
    oninput: (e) => { form[key] = e.target.value; updateTotal(); }, ...attrs
  });

  function renderBody() {
    const assetSelect = h('select', { class: 'input select', onchange: (e) => { form.assetId = e.target.value; renderBody(); } },
      state.assets.map((a) => h('option', { value: a.id, selected: a.id === form.assetId }, `${a.name} (${a.type})`)),
      h('option', { value: NEW, selected: form.assetId === NEW }, '＋ Nuovo strumento…'));

    const newAsset = form.assetId === NEW ? h('div', { class: 'subcard' },
      field('Nome strumento', h('input', { class: 'input', placeholder: 'Es. Vanguard FTSE All-World, Apple, Bitcoin…', value: form.newName, oninput: (e) => (form.newName = e.target.value) })),
      field('Tipo', h('select', { class: 'input select', onchange: (e) => (form.newType = e.target.value) },
        ASSET_TYPES.map((t) => h('option', { value: t, selected: t === form.newType }, t))))
    ) : null;

    const numbers = form.kind === 'dividendo'
      ? h('div', { class: 'row gap' },
        field('Importo ricevuto (€)', input('amount', { placeholder: '0,00' })),
        field('Tasse/comm. (€)', input('fees', { placeholder: '0,00' })))
      : h('div', {},
        h('div', { class: 'row gap' },
          field('Quantità', input('qty', { placeholder: 'Es. 2 o 0,005' })),
          field('Prezzo unitario (€)', input('price', { placeholder: '0,00' }))),
        field('Commissioni (€)', input('fees', { placeholder: '0,00' })));

    const accountSelect = h('select', { class: 'input select', onchange: (e) => (form.accountId = e.target.value) },
      state.accounts.map((a) => h('option', { value: a.id, selected: a.id === form.accountId }, a.name)),
      h('option', { value: '', selected: !form.accountId }, 'Nessun conto'));

    body.replaceChildren(
      field('Strumento', assetSelect),
      newAsset,
      segmented([['acquisto', 'Acquisto'], ['vendita', 'Vendita'], ['dividendo', 'Dividendo/cedola']], form.kind, (v) => { form.kind = v; renderBody(); }),
      numbers,
      total,
      h('div', { class: 'row gap' },
        field('Data', h('input', { class: 'input', type: 'date', value: form.date, max: todayISO(), onchange: (e) => (form.date = e.target.value) })),
        field('Da/verso il conto', accountSelect, 'Il saldo del conto si aggiorna')),
      field('Note', h('input', { class: 'input', value: form.note, placeholder: 'Facoltativo', oninput: (e) => (form.note = e.target.value) }))
    );
    updateTotal();
  }
  renderBody();

  async function submit() {
    let assetId = form.assetId;
    const qty = parseDecimal(form.qty), price = parseDecimal(form.price);
    const fees = parseDecimal(form.fees) || 0, amount = parseDecimal(form.amount);
    if (form.kind === 'dividendo') {
      if (!(amount > 0)) return toast('Inserisci l’importo ricevuto', 'error');
    } else if (!(qty > 0) || !(price > 0)) return toast('Inserisci quantità e prezzo', 'error');

    if (assetId === NEW) {
      if (!form.newName.trim()) return toast('Dai un nome allo strumento', 'error');
      const a = await saveAsset({ name: form.newName.trim(), type: form.newType, price: form.kind !== 'dividendo' ? price : 0, priceDate: form.date });
      assetId = a.id;
    } else {
      const a = assetById(assetId);
      // se il prezzo attuale non è mai stato impostato, usa quello dell'operazione
      if (a && !a.price && form.kind !== 'dividendo') await saveAsset({ ...a, price, priceDate: form.date });
    }
    await saveOp({
      ...(op || {}),
      assetId, kind: form.kind, date: form.date || todayISO(),
      qty: form.kind === 'dividendo' ? 0 : qty,
      price: form.kind === 'dividendo' ? 0 : price,
      fees, amount: form.kind === 'dividendo' ? amount : 0,
      accountId: form.accountId || null,
      note: form.note.trim()
    });
    toast(op ? 'Operazione aggiornata' : 'Operazione salvata');
    close();
    ctx.refresh();
  }

  return h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); submit(); } },
    body,
    h('div', { class: 'form-actions' },
      op ? h('button', {
        type: 'button', class: 'btn danger ghost',
        onclick: async () => {
          if (!(await confirmDialog('Eliminare questa operazione?', { ok: 'Elimina', danger: true }))) return;
          await deleteOp(op.id); toast('Operazione eliminata'); close(); ctx.refresh();
        }
      }, 'Elimina') : null,
      h('button', { type: 'submit', class: 'btn lav grow' }, 'Salva operazione')
    )
  );
}
