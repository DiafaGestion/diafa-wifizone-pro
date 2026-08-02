# DIAFA WIFIZONE PRO

Gestion des ventes de tickets Mikhmon (revendeurs Hotspot MikroTik) — React + Firebase/Firestore + Vite.

## Structure du dépôt

```
diafa-wifizone-pro/
├── index.html          ← point d'entrée Vite (dev + build)
├── package.json
├── vite.config.js
├── public/
│   ├── manifest.json   ← PWA
│   ├── sw.js            ← Service Worker (cache "fast-open")
│   ├── icon-192.png
│   └── icon-512.png
└── src/
    ├── main.jsx         ← monte <App /> et enregistre le service worker
    └── App.jsx           ← l'application complète (~6000 lignes)
```

## Installation

```bash
npm install
```

## Développement local

```bash
npm run dev
```

## Build de production (à importer/déployer)

```bash
npm run build
```

Le dossier `dist/` généré est celui à déployer sur cPanel / hébergement statique — il contient
`index.html`, `manifest.json`, les icônes, `sw.js`, et un dossier `assets/` avec les fichiers
JS/CSS "hashés" (React, Firebase, xlsx, Recharts découpés en chunks séparés pour un chargement
rapide, comme dans le build `v3.9.8` d'origine).

```bash
npm run preview   # pour tester le build localement avant déploiement
```

## Déployer sur GitHub Pages (https://diafagestion.github.io/diafa-wifizone-pro/)

Le dépôt inclut `.github/workflows/deploy.yml` : à chaque `git push` sur `main`, GitHub build
et publie automatiquement le site — pas besoin de builder/uploader `dist/` à la main.

**Étapes (une seule fois) :**
1. Pousse ce dépôt sur `https://github.com/diafagestion/diafa-wifizone-pro` (branche `main`).
2. Sur GitHub → onglet **Settings** du dépôt → **Pages** (menu de gauche).
3. Sous **Build and deployment** → **Source**, choisis **GitHub Actions** (et non "Deploy from a branch").
4. Le workflow se déclenche automatiquement (visible dans l'onglet **Actions**). Une fois vert,
   le site est en ligne à `https://diafagestion.github.io/diafa-wifizone-pro/`.

**Important** : `vite.config.js` utilise `base: "./"` (chemin relatif) — c'est ce qui permet au
même build de fonctionner tel quel sur GitHub Pages (sous `/diafa-wifizone-pro/`), sur cPanel,
ou dans n'importe quel sous-dossier, sans rien coder en dur. C'est exactement le même principe
que ton ancien build qui fonctionnait (`./assets/...`, `./manifest.json`) — ne remplace pas ça
par un chemin absolu du type `/diafa-wifizone-pro/`, ça casserait le jour où tu renommes le
dépôt ou redéploies ailleurs.

Si la page reste blanche après déploiement : ouvre la console du navigateur (F12) — une
erreur 404 sur les fichiers `.js`/`.css` signifie presque toujours un souci de chemin de base,
ou que GitHub Pages sert encore le code source au lieu du contenu buildé de `dist/`.

## Importer dans GitHub

```bash
git init
git add .
git commit -m "DIAFA WIFIZONE PRO — refonte UI premium (v3.9.8)"
git branch -M main
git remote add origin https://github.com/<votre-compte>/<votre-repo>.git
git push -u origin main
```

`node_modules/` et `dist/` sont ignorés (`.gitignore`) — seul le code source est versionné,
ce qui est la pratique standard pour un dépôt GitHub. Le build (`npm run build`) se refait
à chaque déploiement, ou peut être automatisé avec une GitHub Action si besoin.

## Notes

- Firebase est déjà configuré dans `src/App.jsx` (projet `diafa-wifizone-pro`) — aucune variable
  d'environnement supplémentaire n'est nécessaire pour Firestore.
- Les polices Inter sont chargées depuis Google Fonts dans `index.html`.
- Le design a été entièrement refondu (palette sombre premium, glassmorphism, dégradés,
  animations CSS) sans toucher à la logique métier ni aux appels Firestore.
