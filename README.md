# Gestionale

App personale per tenere traccia di **spese, entrate e investimenti**, pensata per iPhone.
Gratuita, senza account, senza server: **i dati restano sul telefono**, con backup in Excel.

Palette: Lemon `#FFF21A` · Charcoal `#171717` · Electric Lavender `#A66BFF`.

## Cosa fa

- **Dashboard**: saldo del mese, entrate/spese/risparmio, liquidità e patrimonio, spese per categoria, andamento 6 mesi, investimenti, ultimi movimenti.
- **Movimenti**: lista per giorno, filtri per mese, tipo, categoria e ricerca. Tocca una riga per modificarla.
- **Aggiungi (+)**: spesa, entrata o operazione d'investimento.
  - **Scansiona**: foto dello scontrino o screenshot della banca → legge importo, data, esercente e propone la categoria (OCR gratuito sul telefono, Tesseract.js).
  - **Incolla testo**: copia il testo da una foto (Testo Live dell'iPhone) o da una notifica e incollalo.
  - La categoria si impara: ogni spesa salvata insegna all'app in che categoria va quell'esercente.
- **Investimenti**: strumenti (ETF, azioni, crypto, depositi…), acquisti/vendite/dividendi, costo medio, valore e rendimento. Il prezzo attuale si aggiorna a mano.
- **Impostazioni**: export/import Excel, conti, categorie (icona, colore, parole chiave), dati di esempio.

## Provarla

**Dal telefono**: apri il link di GitHub Pages in Safari e usala come un sito.
**Installarla**: in Safari → Condividi → *Aggiungi alla schermata Home*.

> Su iPhone, Safari e l'app installata hanno archivi separati: i dati inseriti
> nella prova da Safari non compaiono nell'app installata. Per portarli: Esporta Excel → Importa Excel.

**Dal computer** (serve Python):

```bash
cd Gestionale
python3 -m http.server 8000
# apri http://localhost:8000
```

## Pubblicare con GitHub Pages

Repository → **Settings → Pages** → *Source: Deploy from a branch* → Branch `main`, cartella `/ (root)` → Save.
Dopo un paio di minuti l'app è su `https://<utente>.github.io/Gestionale/`.

Quando modifichi i file, aumenta `VERSION` in `sw.js` così i telefoni scaricano la versione nuova.

## Struttura

```
index.html            pagina principale
manifest.webmanifest  nome, icona, colori per "Aggiungi a Home"
sw.js                 funzionamento offline
css/style.css         stile
js/app.js             avvio e navigazione
js/db.js              database del telefono (IndexedDB)
js/model.js           dati, calcoli, categorie automatiche
js/xlsx.js            export/import Excel scritto a mano (un .xlsx è uno ZIP di XML)
js/scan.js            OCR e lettura scontrini
js/charts.js          grafici SVG
js/ui.js              componenti dell'interfaccia
js/views/*.js         le schermate
```

Nessuna libreria da installare e nessuna build: sono file statici. Gli importi dei movimenti
sono salvati in centesimi (interi) per evitare errori di arrotondamento.
