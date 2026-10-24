# 📅 UVSQ EDT

Ton emploi du temps UVSQ (CELCAT), directement sur ton téléphone.
Ouvre le lien, entre ton **numéro étudiant** (+ tes identifiants ENT si l'app les demande) — c'est tout.

🌐 **https://uvsq-project.vercel.app**

C'est une **PWA** (Progressive Web App) : pas d'App Store, pas de Play Store — le navigateur « installe » l'app sur ton écran d'accueil et elle fonctionne comme une vraie application, **même sans réseau** (le dernier EDT gardé en cache s'affiche).

---

## 📱 Installer sur iPhone (iOS / iPadOS)

1. Ouvre ce lien dans **Safari** : `https://uvsq-project.vercel.app`
2. Entre ton numéro étudiant (et tes identifiants ENT si l'app te le demande).
3. Appuie sur le bouton **Partager** ⬆️ (en bas de l'écran).
4. Choisis **« Sur l'écran d'accueil »** → **Ajouter**.

> 💡 L'app affiche un bandeau qui te guide la première fois. Une fois installée, l'app s'ouvre en plein écran, sans les barres du navigateur.

*(Nécessite iOS 13 ou plus récent — utilise toujours Safari, Chrome iOS ne supporte pas l'installation.)*

## 🤖 Installer sur Android (Chrome, Samsung Internet, Edge...)

1. Ouvre le lien : `https://uvsq-project.vercel.app`
2. Entre ton numéro étudiant (et tes identifiants ENT si demandé).
3. Le navigateur te propose d'**Installer l'application** :
   - via la bannière en haut/bas de l'écran, **ou**
   - via le menu **⋮** → **« Installer l'application »** / **« Ajouter à l'écran d'accueil »**.

> Sur Samsung Internet, le menu s'appelle **Ajouter une page à → Écran d'accueil**.

## 📲 Widget « Prochain cours » (iPhone)

Un vrai widget d'écran d'accueil iOS via l'app gratuite **Scriptable** :
*ton cours dans 12 min · titre · salle*, mis à jour toutes les 10 minutes.

👉 Instructions complètes : **[widget/README.md](widget/README.md)**

*(Sur Android, l'app installée a déjà une icône sur l'écran d'accueil — un widget semblable via KWGT est envisagé.)*

---

## ✨ Ce que l'app fait

- 📆 Ton EDT UVSQ en vues **jour, semaine et mois**
- ⏰ **Prochain cours en direct**
- 📴 **Fonctionne hors ligne** : l'app s'ouvre et affiche le dernier EDT connu, même sans réseau
- 🔒 **Rien n'est stocké sur un serveur** : tes infos restent sur ton téléphone
- 🌙 Interface sombre, pensée pour le mobile

## 🔐 Confidentialité

Ton numéro étudiant et tes identifiants ENT (si demandés) sont gardés **uniquement sur ton appareil** (localStorage). Ils transitent chiffrés (HTTPS) vers un serveur Vercel qui vers edt.uvsq.fr — **aucune base de données, aucun compte créé**. Chaque numéro étudiant ne voit que le propre emploi du temps de son compte.

Détails techniques : [docs/SECURITE-API.md](docs/SECURITE-API.md)

## 🛠 Pour les curieux / développeurs

| Élément | Détail |
|---|---|
| Interface | HTML + Tailwind CSS, PWA installable (manifeste + service worker) |
| Backend | Fonction serverless Vercel (`api/edt.js`), proxy → CELCAT UVSQ |
| Hébergement | Vercel (gratuit), HTTPS automatique |
| Widget iOS | Scriptable (voir [widget/README.md](widget/README.md)) |

### Déployer ta propre instance

1. Fork/clone le dépôt, puis déploie sur [Vercel](https://vercel.com) (import du projet, zéro config — `vercel.json` est fourni).
2. Utilise ton URL à la place de `https://uvsq-project.vercel.app` partout (widget, QR codes…).
3. Guide de partage avec les autres étudiants de ta promo : **[docs/PARTAGE.md](docs/PARTAGE.md)**

### Développement local

```bash
npx serve .        # ou tout autre serveur statique (toutes les dépendances sont des CDN)
```

---

Fabriqué pour les étudiants de l'IUT de Vélizy / UVSQ 💙
