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
- ✉️ Ta **messagerie UVSQ** (Partage) : lecture et envoi d'e-mails, adaptée au mobile — plus besoin de l'interface web non responsive (onglet « Messagerie » de l'app ; identifiants UVSQ, la messagerie attend ton adresse mail @etu.uvsq.fr comme login — [doc UVSQ](https://www.uvsq.fr/comment-consulter-vos-messages)). **Tous les dossiers** : Boîte de réception, Envoyés, Spam, Corbeille et Archives — les mails que tu envoies depuis l'app déposent leur copie dans « Envoyés », les supprimés partent automatiquement dans la corbeille, et un archivage façon Gmail sort le mail de la réception sans le perdre. **Pièces jointes téléchargeables** en un clic depuis le lecteur (fichiers jusqu'à ~3 Mo via l'app ; au-delà, elle t'oriente vers le webmail)
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
- 📖 **Lecteur qui s'adapte au mail** : les publipostages sont marqués « Newsletter », les confirmations de service « UVSQ », les invitations en calendrier « Invitation » — le corps est mis en paragraphes réels pour la lecture au pouce. Un long mail se coupe après ~2 écrans : le bouton « Afficher les mails longs en entier » mémorise ton choix (plus rien n'est coupé ensuite, « Ré-couper » inverse). Avatar coloré à initiales et date relative (« aujourd'hui · 14:32 »).
- 🖥️ **Bouton « Enregistrer » réparé sur PC** : sur certains navigateurs (Firefox/Safari variants), la demande de permission de notification bloquait la sauvegarde — c'est corrigé, la sauvegarde se fait toujours en premier.
- 📬 **Serveurs Partage officiels** : connexion désormais pointée vers `partage.uvsq.fr` (IMAP port 993, SMTP port 465) selon la doc UVSQ — cause du « impossible de récupérer les emails » corrigée.
- 📂 **Dossiers IMAP complets** : la messagerie ne se limite plus à la réception — sélecteur de dossiers (Boîte de réception / Envoyés / Spam / Corbeille) alimenté par la découverte automatique des dossiers réels du compte Partage (attributs spéciaux IMAP \Sent, \Junk, \Trash, repli par nom). Les envois de l'app déposent leur copie dans « Envoyés » (best-effort), le uid de chaque mail est désormais résolu dans son propre dossier, les caches hors-ligne sont séparés par dossier et purgés à la déconnexion.
- 📎 **Pièces jointes téléchargeables** : dans le lecteur, chaque pièce jointe est une puce cliquable avec sa taille — le fichier est téléchargé sur ton appareil. La détection couvre les trois habitudes des serveurs (disposition « attachment », inline avec nom, nom seul sur part non-texte) et un harnais de régression (`debug-attachments.mjs`) valide 23 cas (structures MIME, adresses sans From, RFC 2047, mojibake charset et encoded-words, décodage d'aperçu texte/HTML-only, sélection de la partie texte) contre les parsers réels. Limite technique honnête : jusqu'à ~3 Mo via l'app ; au-delà, l'invite indique le webmail Partage.
- 🧰 **Quatre actions dans le lecteur** : « Répondre » (rédacteur pré-rempli), « Archiver » (façon Gmail : le mail quitte la réception sans passer par la corbeille — le dossier « Archives » est créé automatiquement au premier archivage et devient une puce du sélecteur), « Déplacer vers… » (menu avec les autres dossiers du compte) et « Supprimer » (le mail part automatiquement dans la corbeille Partage — jamais de suppression définitive ni de vidage de corbeille depuis l'app). Chaque action est validée par le serveur et met à jour la liste et le cache hors-ligne instantanément.
- 📔 **Noms des profs proposés automatiquement** : quand tu écris un mail, tape les premières lettres du nom et l'app propose l'adresse — carnet alimenté par tes mails reçus et les profs de ton emploi du temps (celles déduites de l'EDT sont marquées « adresse déduite, à vérifier »).
- 🔔 **L'alerte « cours imminent » fonctionne vraiment** : elle était appelée par le minuteur mais jamais définie dans le code (rien ne s'envoyait jamais) — la notification est désormais en place, une seule fois par cours.

## 📋 Changelog détaillé — la série messagerie (octobre 2026)

*(État vérifié : tous ces commits sont déjà sur `origin/main` — rien n'attend de `git push`. Les harnais cités se rejouent avec `node front-smoke.mjs`, `node api-smoke.mjs`, `node debug-attachments.mjs`.)*

**Fonctionnalités messagerie**
- `1ce6b0f` · dossiers Partage complets (réception, envoyés, spam, corbeille), alimentés par la découverte IMAP automatique, caches séparés par dossier
- `2b1e445` · archivage façon Gmail, dossier « Archives » créé automatiquement au premier clic
- `33f5082` · pièces jointes téléchargeables (numéro de part MIME réel, conversion base64 → Blob)
- `501bc5a` · lecteur adapté au type : avatars à initiales, date relative, badges Invitation/Newsletter/Service UVSQ, corps en paragraphes
- `5d5439f` · choix « Afficher les mails longs en entier » mémorisé (préférence locale, « Ré-couper » pour revenir)

**Corrections de fond**
- `8bdcb22` · **expéditeur toujours « Inconnu » dans le lecteur** : `parsed.from.data` n'existe pas chez mailparser — adresse réparée, incluant les listes de groupes
- `89939d9` · lecteur fermé au changement de dossier (un mail ouvert portait l'UID de l'ancien dossier — jusqu'à pouvoir toucher un autre mail) + session CELCAT périmée retournée en login frais au lieu d'un faux « identifiants refusés »
- `9c3bcfa` · garde de méthodes manquante sur `/api/edt` : PUT/DELETE passaient au-delà des validations
- `684f334` · détection des pièces jointes robuste aux trois variations Partage (disposition, inline avec nom, nom seul sur part non-texte)
- `ffeee74` · seuil « Afficher la suite » adaptatif (~2 écrans par appareil, plancher 3 200 caractères, coupe invisible sur desktop)
- `f097e29` · caractères « � » réparés : certains notificateurs déclarent `charset=utf-8` pour un corps réellement Windows-1252 — l'app re-parse la source en remplaçant l'étiquette mensongère, les accents (`é`, `à`) restent lisibles (harnais : cas M et N)
- `592ca2c` · **sujet mojibake réparé aussi** : le Sujet des notificateurs Exchange se déclare `=?utf-8?B/Q?…?` sur des octets réellement Windows-1252 → « � » dans le lecteur ET les listes ; les encoded-words mensongers sont maintenant relabelés avec le Content-Type, la réparation se déclenche si le sujet porte des « � » (getMail) et la liste re-fetch la source (~16 Ko) uniquement pour ces mails rares (harnais : cas V et W)
- `f046655` · aperçu non vide pour les alternatives à plain vide : certains expéditeurs mettent une partie `text/plain` coquille (size 0) dont seul le HTML porte le corps — l'aperçu des listes descend sur le HTML au lieu d'être vide (harnais : cas T et U)
- `43085c1` · entités HTML décodées aussi : les mails sans `text/plain` affichaient « &#233;vénement » au lieu de « événement » (aperçu ET lecteur — `htmlToText` ne décodait que cinq entités) ; décodage numérique déc/hex + entités latines courantes, cinq de base en dernier (jamais de double décodage). Harnais : cas R (chemin HTML-only exact de `buildPreview`) et S (entités nommées)
- `255b363` · mêmes « � » réparés **dans l'aperçu des listes** aussi : `buildPreview` décode les octets du part en UTF-8 strict avec repli Windows-1252 (et amortit la coupe en plein milieu d'un caractère multioctet du maxBytes) — l'aperçu passe par un autre chemin de code que le lecteur, il avait le même bug (harnais : cas O·P·Q). Audit SMTP joint : le sujet répondu part bien encodé RFC 2047, aucun octet non-ASCII brut dans les en-têtes — verrouillé dans `api-smoke.mjs`
- `dae2fce` · ménage des formules maladroites glissées dans harnais et docs

**Harnais de régression (conservés et rejouables)**
- `f8b9edd` · `front-smoke.mjs` — cohérence statique HTML/JS + 8 cas de classification du lecteur (`1fa293a`)
- Sonde de production (optionnelle) : `scripts/verify-previews.mjs` compte les « � » dans de vrais aperçus servis par Vercel — `MAIL_USER="…" MAIL_PASS="…" node scripts/verify-previews.mjs` (identifiants passés par l'environnement, jamais stockés dans le dépôt ; `--all` pour les quatre dossiers)
- `9c3bcfa` · `api-smoke.mjs` — 20 cas de contrat API sans réseau (+1 cas audit d'encodage SMTP du sujet répondu, `255b363`)
- `684f334` · `debug-attachments.mjs` — 6 structures MIME contre le vrai parser imapflow (`f138cf8`, `89ee4a7` : + cas adresses sans From et RFC 2047 B/Q ; `f097e29` : + cas mojibake M·N ; `255b363` : + cas aperçu O·P·Q ; `43085c1` : + cas HTML-only R·S ; `f046655` : + cas alternative T·U ; `592ca2c` : + cas encoded-word V·W)

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
