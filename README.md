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
