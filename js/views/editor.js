// Pannello per aggiungere o modificare un movimento: spesa, entrata o investimento.
import {
  state, categoriesOf, saveTransaction, deleteTransaction, todayISO, guessCategory, learnRule
} from '../model.js';
import {
  h, openSheet, segmented, field, toast, confirmDialog, pickFile, parseEuro, centsToInput
} from '../ui.js';
import { recognize, parseReceipt, thumbnail } from '../scan.js';

const PLACEHOLDER = {
  spesa: 'Es. Esselunga, Netflix…',
  entrata: 'Es. Stipendio ottobre',
  investimento: 'Es. PAC mensile, versamento broker'
};
const SAVED = { spesa: 'Spesa salvata', entrata: 'Entrata salvata', investimento: 'Investimento salvato' };

/** opts: { kind: 'spesa'|'entrata'|'investimento', tx?: movimento da modificare } */
export function openEditor(ctx, opts = {}) {
  let mode = opts.kind || 'spesa';
  const editingTx = opts.tx || null;
  openSheet(({ close, render }) => {
    const wrap = h('div', { class: 'editor' });
    wrap.append(segmented([['spesa', 'Spesa'], ['entrata', 'Entrata'], ['investimento', 'Investimento']],
      mode, (v) => { mode = v; render(); }, 'big'));
    wrap.append(transactionForm(ctx, close, mode, editingTx));
    return wrap;
  }, { title: editingTx ? 'Modifica movimento' : 'Nuovo movimento' });
}

// ================= Form =================

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
  // se c'è una sola categoria (es. Investimenti), sceglila subito
  const kindCats = categoriesOf(kind);
  if (!form.categoryId && kindCats.length === 1) { form.categoryId = kindCats[0].id; form.manual = true; }
  let suggestion = null;
  let ocrText = '';

  const amountInput = h('input', {
    class: 'input amount', inputmode: 'decimal', placeholder: '0,00', value: form.amount, autocomplete: 'off',
    oninput: (e) => (form.amount = e.target.value)
  });
  const noteInput = h('input', {
    class: 'input', placeholder: PLACEHOLDER[kind], value: form.note,
    oninput: (e) => {
      form.note = e.target.value;
      if (!form.manual) {
        suggestion = guessCategory({ merchant: form.note, text: ocrText }, kind);
        form.categoryId = suggestion?.categoryId || null;
        applyAccount(suggestion);
        renderChips();
      }
    }
  });
  const dateInput = h('input', { class: 'input', type: 'date', value: form.date, max: todayISO(), onchange: (e) => (form.date = e.target.value) });
  const accountSelect = h('select', { class: 'input select', onchange: (e) => (form.accountId = e.target.value) },
    state.accounts.map((a) => h('option', { value: a.id, selected: a.id === form.accountId }, a.name)));
  let accountTouched = !!tx;
  accountSelect.addEventListener('change', () => (accountTouched = true));
  // se l'esercente è già noto, proponi anche il conto usato l'ultima volta
  function applyAccount(sug) {
    if (accountTouched || !sug?.accountId || !state.accounts.some((a) => a.id === sug.accountId)) return;
    form.accountId = sug.accountId;
    accountSelect.value = sug.accountId;
  }

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
      ? '✨ Categoria suggerita'
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
    if (suggestion) { form.categoryId = suggestion.categoryId; form.manual = false; applyAccount(suggestion); found.push('categoria'); }
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
    if (form.note.trim()) await learnRule(form.note, form.categoryId, form.accountId);
    toast(tx ? 'Movimento aggiornato' : SAVED[kind]);
    close();
    ctx.refresh();
  }

  return h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); submit(); } },
    scanTools,
    h('label', { class: 'amount-field ' + kind }, h('span', { class: 'currency' }, '€'), amountInput),
    field(kind === 'spesa' ? 'Descrizione / esercente' : 'Descrizione', noteInput),
    kindCats.length > 1 ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Categoria'), chips, suggestionNote) : null,
    h('div', { class: 'row gap' }, field('Data', dateInput), field(kind === 'entrata' ? 'Sul conto' : 'Dal conto', accountSelect)),
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
