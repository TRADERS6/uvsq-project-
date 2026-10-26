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
- ✉️ Ta **messagerie UVSQ** (Partage) : lecture et envoi d'e-mails, adaptée au mobile — plus besoin de l'interface web non responsive (onglet « Messagerie » de l'app ; identifiants UVSQ, la messagerie attend ton adresse mail @etu.uvsq.fr comme login — [doc UVSQ](https://www.uvsq.fr/comment-consulter-vos-messages)). **Tous les dossiers** : Boîte de réception, Envoyés, Spam et Corbeille — les mails que tu envoies depuis l'app déposent leur copie dans « Envoyés », comme le webmail
- 📔 **Carnet d'adresses auto-complété** : en rédigeant un mail, tape juste le nom — l'app te propose les adresses des **profs de ton EDT** et des personnes qui t'ont déjà écris (aucune adresse à retenir par cœur ; celles déduites de l'EDT sont signalées « à vérifier »)
- 🔔 **Alerte « cours imminent »** (optionnelle) : notifie 10 min avant le début d'un cours si l'autorisation de notification est accordée
- ⏰ **Prochain cours en direct**
- 📴 **Fonctionne hors ligne** : l'app s'ouvre et affiche le dernier EDT connu, même sans réseau
- 🔒 **Rien n'est stocké sur un serveur** : tes infos restent sur ton téléphone
- 🌙 Interface sombre, pensée pour le mobile

## 🗒️ Nouveautés récentes

**Mise à jour d'octobre 2026 — la messagerie bien mieux orchestrée**

- 📮 **Connecté = Messagerie en premier onglet** : dès que tes identifiants existent dans l'app, elle s'ouvre directement sur la messagerie (l'EDT se charge en tâche de fond, toujours accessible en bas).
- 🔎 **EDT toujours neutre** : en cas d'échec de l'API, la vue affiche « Aucun cours prévu » comme un jour libre — plus de bandeau rouge d'erreur (la trace reste visible dans la console via F12).
- 🧭 **Connexion simplifiée** : entre ton numéro étudiant seul, l'app essaie automatiquement les formats d'adresse UVSQ (ex. `numero@etu.uvsq.fr`). Si le serveur n'en accepte aucun, elle te dit précisément d'utiliser ton adresse mail complète. Le format gagnant est mémorisé : plus jamais à le ressaisir.
- 🖥️ **Bouton « Enregistrer » réparé sur PC** : sur certains navigateurs (Firefox/Safari variants), la demande de permission de notification bloquait la sauvegarde — c'est corrigé, la sauvegarde se fait toujours en premier.
- 📬 **Serveurs Partage officiels** : connexion désormais pointée vers `partage.uvsq.fr` (IMAP port 993, SMTP port 465) selon la doc UVSQ — cause du « impossible de récupérer les emails » corrigée.
- 📂 **Dossiers IMAP complets** : la messagerie ne se limite plus à la réception — sélecteur de dossiers (Boîte de réception / Envoyés / Spam / Corbeille) alimenté par la découverte automatique des dossiers réels du compte Partage (attributs spéciaux IMAP \Sent, \Junk, \Trash, repli par nom). Les envois de l'app déposent leur copie dans « Envoyés » (best-effort), le uid de chaque mail est désormais résolu dans son propre dossier, les caches hors-ligne sont séparés par dossier et purgés à la déconnexion.
- 📔 **Noms des profs proposés automatiquement** : quand tu écris un mail, tape les premières lettres du nom et l'app propose l'adresse — carnet alimenté par tes mails reçus et les profs de ton emploi du temps (celles déduites de l'EDT sont marquées « adresse déduite, à vérifier »).
- 🔔 **L'alerte « cours imminent » fonctionne vraiment** : elle était appelée par le minuteur mais jamais définie dans le code (rien ne s'envoyait jamais) — la notification est désormais en place, une seule fois par cours.

## 🔐 Confidentialité

Ton numéro étudiant et tes identifiants ENT (si demandés) sont gardés **uniquement sur ton appareil** (localStorage). Ils transitent chiffrés (HTTPS) vers un serveur Vercel qui vers edt.uvsq.fr — **aucune base de données, aucun compte créé**. Chaque numéro étudiant ne voit que le propre emploi du temps de son compte.

Détails techniques : [docs/SECURITE-API.md](docs/SECURITE-API.md)

## 🛠 Pour les curieux / développeurs

| Élément | Détail |
|---|---|
| Interface | HTML + Tailwind CSS, PWA installable (manifeste + service worker) |
| Backend | Fonctions serverless Vercel (`api/edt.js` proxy → CELCAT UVSQ, `api/mail.js` → serveurs Partage UVSQ) |
| Hébergement | Vercel (gratuit), HTTPS automatique |
| Widget iOS | Scriptable (voir [widget/README.md](widget/README.md)) |

### Déployer ta propre instance

1. Fork/clone le dépôt, puis déploie sur [Vercel](https://vercel.com) (import du projet, zéro config — `vercel.json` est fourni).
2. Utilise ton URL à la place de `https://uvsq-project.vercel.app` partout (widget, QR codes…).
3. Guide de partage avec les autres étudiants de ta promo : **[docs/PARTAGE.md](docs/PARTAGE.md)**

### Développement local

```bash
npx vercel dev     # front + fonctions API (/api/edt, /api/mail) — l'EDT et la messagerie fonctionnent
```

> ⚠️ Un serveur statique (`npx serve .`) ne suffit pas : les API `/api/*` sont des fonctions Vercel, l'EDT et les e-mails ne marcheront pas.

---

Fabriqué pour les étudiants de l'IUT de Vélizy / UVSQ 💙
