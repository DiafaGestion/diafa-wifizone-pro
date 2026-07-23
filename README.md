# DIAFA WIFIZONE PRO

Application de gestion des ventes pour revendeurs Mikhmon (Hotspot MikroTik).
Phase 1 : Import CSV · Revendeurs · Tarifs · Tableau de bord · Rapport Hebdomadaire · Rapport Mensuel.

**Web app responsive** — utilisable sur PC, Android et iPhone depuis un navigateur, et
**installable** comme une app native (icône sur l'écran d'accueil, plein écran, fonctionne
hors-ligne) grâce au manifeste PWA inclus.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvrez ensuite l'URL affichée (par défaut http://localhost:5173).

Les données (revendeurs, tickets, tarifs, semaines clôturées) sont stockées dans le
`localStorage` du navigateur — donc propres à chaque appareil/navigateur tant que la Phase 2
(base SQLite embarquée + synchronisation) n'est pas branchée.

## Utilisation sur mobile (Android / iPhone)

Une fois le site hébergé (voir section GitHub Pages ci-dessous), ouvrez l'URL sur le
téléphone puis :

- **Android (Chrome)** : menu ⋮ → *Installer l'application* (ou *Ajouter à l'écran d'accueil*).
- **iPhone (Safari)** : bouton Partager 􀈂 → *Sur l'écran d'accueil*.

L'app s'ouvre alors en plein écran comme une application native, avec sa propre icône,
et reste utilisable hors connexion grâce au service worker (`public/sw.js`).

## Héberger ce projet sur GitHub

### 1. Créer le dépôt sur GitHub
Allez sur https://github.com/new, donnez un nom (ex. `diafa-wifizone-pro`), laissez-le
vide (sans README/licence, ils existent déjà ici), puis cliquez **Create repository**.

### 2. Pousser le code depuis votre machine
Depuis ce dossier :

```bash
git init
git add .
git commit -m "Initial commit — DIAFA WIFIZONE PRO Phase 1"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/diafa-wifizone-pro.git
git push -u origin main
```

### 3. Publier en ligne avec GitHub Pages (accessible PC + mobile)
```bash
npm install -D gh-pages
```
Ajoutez dans `package.json` :
```json
"homepage": "https://VOTRE-COMPTE.github.io/diafa-wifizone-pro",
"scripts": {
  "deploy": "vite build && gh-pages -d dist"
}
```
Puis :
```bash
npm run deploy
```
Activez ensuite GitHub Pages sur la branche `gh-pages` dans
**Settings → Pages** du dépôt. L'app sera accessible sur
`https://VOTRE-COMPTE.github.io/diafa-wifizone-pro` depuis n'importe quel appareil.

## Prochaine étape : version Windows (Electron) — déjà prête !

Ce projet inclut désormais la configuration Electron complète (`electron/main.js` + config
`electron-builder` dans `package.json`).

```bash
npm install
npm run electron:build
```

Cela génère un vrai `Setup.exe` dans le dossier `release/` — installable, avec icône sur le
bureau et dans le menu Démarrer, sans navigateur ni connexion Internet requise une fois installé.

Pour tester l'app en mode développement dans une fenêtre Electron (avant de générer le `.exe`) :
```bash
npm run electron:dev
```


## Structure

```
diafa-wifizone-pro/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── public/
│   ├── manifest.json    # manifeste PWA (installable Android/iPhone)
│   ├── sw.js             # service worker (mode hors-ligne)
│   ├── icon-192.png
│   └── icon-512.png
├── src/
│   ├── main.jsx          # point d'entrée React + enregistrement du service worker
│   └── App.jsx            # application complète, responsive (desktop/tablette/mobile)
└── README.md
```
