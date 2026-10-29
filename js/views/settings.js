import {
  state, accountBalance, saveAccount, deleteAccount, saveCategory, deleteCategory, categoriesOf,
  wipeEverything, loadDemoData, clearRules, CATEGORY_COLORS
} from '../model.js';
import { downloadBackup, importWorkbook } from '../xlsx.js';
import { h, eur, shortDate, openSheet, field, toast, confirmDialog, pickFile, parseEuro, centsToInput, sectionTitle, segmented } from '../ui.js';

export function renderSettings(ctx) {
  const root = h('div', { class: 'page' });
  root.append(h('header', { class: 'top' }, h('h1', { class: 'display sm' }, 'Impostazioni')));

  // --- Backup Excel
  const last = state.meta.lastExport;
  root.append(sectionTitle('Backup Excel'));
  root.append(h('section', { class: 'card pad-card' },
    h('p', { class: 'muted' }, 'I dati sono salvati solo su questo telefono. Esporta un file Excel ogni tanto e salvalo in File/iCloud: è il tuo backup e puoi aprirlo con Excel o Numbers.'),
    h('p', { class: 'small' }, last ? `Ultimo export: ${shortDate(last)}` : 'Nessun export ancora fatto.'),
    h('div', { class: 'row gap' },
      h('button', {
        class: 'btn primary grow',
        onclick: async () => {
          try { if (await downloadBackup()) { toast('Backup creato'); ctx.refresh(); } }
          catch (e) { toast('Export non riuscito: ' + e.message, 'error'); }
        }
      }, 'Esporta Excel'),
      h('button', {
        class: 'btn ghost grow',
        onclick: async () => {
          const file = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          if (!file) return;
          if (!(await confirmDialog('Importare questo file? I dati attuali verranno SOSTITUITI con quelli del file.', { ok: 'Importa', danger: true }))) return;
          try {
            const d = await importWorkbook(file);
            toast(`Importati ${d.transactions.length} movimenti`);
            ctx.refresh();
          } catch (e) { toast('Import non riuscito: ' + e.message, 'error'); }
        }
      }, 'Importa Excel')
    ),
    h('p', { class: 'hint' }, 'Le foto degli scontrini restano nell’app e non vengono incluse nel file Excel.')
  ));

  // --- Conti
  root.append(sectionTitle('Conti', h('button', { class: 'link', onclick: () => editAccount(ctx) }, '+ Nuovo')));
  root.append(h('section', { class: 'card list' }, state.accounts.map((a) =>
    h('button', { class: 'tx-row', onclick: () => editAccount(ctx, a) },
      h('span', { class: 'tx-icon', style: { '--c': '#FFF21A' } }, '🏦'),
      h('span', { class: 'tx-text' }, h('strong', {}, a.name), h('small', {}, `Saldo iniziale ${eur(a.initial || 0)}`)),
      h('span', { class: 'tx-amount' }, eur(accountBalance(a.id))))
  )));

  // --- Categorie
  root.append(sectionTitle('Categorie', h('button', { class: 'link', onclick: () => editCategory(ctx, null, 'spesa') }, '+ Nuova')));
  for (const kind of ['spesa', 'entrata']) {
    root.append(h('p', { class: 'eyebrow pad' }, kind === 'spesa' ? 'Spese' : 'Entrate'));
    root.append(h('section', { class: 'card list' }, categoriesOf(kind).map((c) =>
      h('button', { class: 'tx-row', onclick: () => editCategory(ctx, c) },
        h('span', { class: 'tx-icon', style: { '--c': c.color } }, c.emoji),
        h('span', { class: 'tx-text' }, h('strong', {}, c.name),
          h('small', {}, c.keywords?.length ? c.keywords.slice(0, 5).join(', ') + (c.keywords.length > 5 ? '…' : '') : 'nessuna parola chiave')),
        h('span', { class: 'chev' }, '›'))
    )));
  }

  // --- Riconoscimento automatico
  root.append(sectionTitle('Riconoscimento categorie'));
  root.append(h('section', { class: 'card pad-card' },
    h('p', { class: 'muted' }, `L’app ha imparato ${state.rules.length} esercenti dalle tue scelte. Quando salvi una spesa, ricorda in che categoria l’hai messa e la propone la volta dopo. Le parole chiave delle categorie servono per gli esercenti nuovi.`),
    state.rules.length ? h('button', {
      class: 'btn ghost',
      onclick: async () => {
        if (!(await confirmDialog('Dimenticare tutti gli esercenti imparati?', { ok: 'Azzera', danger: true }))) return;
        await clearRules(); toast('Regole azzerate'); ctx.refresh();
      }
    }, 'Azzera esercenti imparati') : null
  ));

  // --- Dati
  root.append(sectionTitle('Dati'));
  root.append(h('section', { class: 'card pad-card' },
    h('div', { class: 'row gap wrap' },
      state.transactions.length === 0 ? h('button', { class: 'btn ghost', onclick: async () => { await loadDemoData(); toast('Dati di esempio caricati'); ctx.go('home'); } }, 'Carica dati di esempio') : null,
      h('button', {
        class: 'btn danger ghost',
        onclick: async () => {
          if (!(await confirmDialog('Cancellare TUTTI i dati (movimenti, investimenti, categorie personalizzate)? Fai prima un backup Excel se ti serve.', { ok: 'Cancella tutto', danger: true }))) return;
          if (!(await confirmDialog('Sei sicuro? L’operazione non si può annullare.', { ok: 'Sì, cancella', danger: true }))) return;
          await wipeEverything(); toast('Dati cancellati'); ctx.go('home');
        }
      }, 'Cancella tutti i dati')
    ),
    h('p', { class: 'hint' }, `Movimenti: ${state.transactions.length} · Strumenti: ${state.assets.length} · Operazioni: ${state.ops.length}`)
  ));

  root.append(h('p', { class: 'muted pad small center' }, 'Gestionale · i dati restano su questo dispositivo'));
  return root;
}

function editAccount(ctx, acc) {
  openSheet(({ close }) => {
    let name = acc?.name || '';
    let initial = acc ? centsToInput(acc.initial || 0) : '';
    return h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.trim()) return toast('Inserisci un nome', 'error');
        const cents = initial.trim() ? parseEuro(initial) : 0;
        if (isNaN(cents)) return toast('Saldo non valido', 'error');
        await saveAccount({ ...(acc || {}), name: name.trim(), initial: cents });
        toast('Conto salvato'); close(); ctx.refresh();
      }
    },
      field('Nome', h('input', { class: 'input', value: name, placeholder: 'Es. Revolut, Carta, Contanti', oninput: (e) => (name = e.target.value) })),
      field('Saldo iniziale (€)', h('input', { class: 'input', inputmode: 'decimal', value: initial, placeholder: '0,00', oninput: (e) => (initial = e.target.value) }),
        'Quanto c’era sul conto quando hai iniziato a usare l’app. Il saldo attuale si calcola da qui.'),
      h('div', { class: 'form-actions' },
        acc ? h('button', {
          type: 'button', class: 'btn danger ghost',
          onclick: async () => {
            if (state.accounts.length <= 1) return toast('Serve almeno un conto', 'error');
            if (!(await confirmDialog(`Eliminare il conto "${acc.name}"?`, { ok: 'Elimina', danger: true }))) return;
            try { await deleteAccount(acc.id); toast('Conto eliminato'); close(); ctx.refresh(); }
            catch (err) { toast(err.message, 'error'); }
          }
        }, 'Elimina') : null,
        h('button', { type: 'submit', class: 'btn primary grow' }, 'Salva'))
    );
  }, { title: acc ? 'Modifica conto' : 'Nuovo conto' });
}

const EMOJIS = ['🛒', '🍽️', '☕', '🚇', '⛽', '🏠', '💡', '💊', '📺', '🛍️', '🎉', '💪', '✈️', '📚', '🏦', '🐶', '👶', '🎁', '💼', '💶', '↩️', '📦', '🧾', '🎮', '🍺', '💈', '🚗', '📱'];

function editCategory(ctx, cat, defaultKind = 'spesa') {
  const f = {
    kind: cat?.kind || defaultKind, name: cat?.name || '', emoji: cat?.emoji || '📦',
    color: cat?.color || CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length],
    keywords: (cat?.keywords || []).join(', ')
  };
  openSheet(({ close, render }) => {
    const finish = close;
    return h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!f.name.trim()) return toast('Inserisci un nome', 'error');
        await saveCategory({
          ...(cat || {}), kind: f.kind, name: f.name.trim(), emoji: f.emoji, color: f.color,
          keywords: f.keywords.split(',').map((s) => s.trim()).filter(Boolean)
        });
        toast('Categoria salvata'); finish(); ctx.refresh();
      }
    },
      cat ? null : segmented([['spesa', 'Spesa'], ['entrata', 'Entrata']], f.kind, (v) => { f.kind = v; render(); }),
      field('Nome', h('input', { class: 'input', value: f.name, oninput: (e) => (f.name = e.target.value) })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icona'),
        h('div', { class: 'emoji-grid' }, EMOJIS.map((em) => h('button', { type: 'button', class: em === f.emoji ? 'active' : '', onclick: () => { f.emoji = em; render(); } }, em)))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Colore'),
        h('div', { class: 'swatches' }, CATEGORY_COLORS.map((c) => h('button', { type: 'button', class: c === f.color ? 'active' : '', style: { background: c }, 'aria-label': c, onclick: () => { f.color = c; render(); } })))),
      field('Parole chiave', h('textarea', { class: 'input', rows: 3, value: f.keywords, placeholder: 'esselunga, conad, coop', oninput: (e) => (f.keywords = e.target.value) }),
        'Separate da virgola. Se lo scontrino o la descrizione contiene una di queste parole, la spesa finisce qui.'),
      h('div', { class: 'form-actions' },
        cat ? h('button', {
          type: 'button', class: 'btn danger ghost',
          onclick: async () => {
            if (!(await confirmDialog(`Eliminare "${cat.name}"? I suoi movimenti passeranno a un'altra categoria.`, { ok: 'Elimina', danger: true }))) return;
            try { const fb = await deleteCategory(cat.id); toast(`Movimenti spostati in "${fb.name}"`); finish(); ctx.refresh(); }
            catch (err) { toast(err.message, 'error'); }
          }
        }, 'Elimina') : null,
        h('button', { type: 'submit', class: 'btn primary grow' }, 'Salva'))
    );
  }, { title: cat ? 'Modifica categoria' : 'Nuova categoria' });
}
