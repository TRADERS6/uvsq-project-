# Partager l'app — fiche projet (étape par étape)

Comment faire découvrir UVSQ EDT aux autres étudiants de l'IUT, et brancher
ton propre nom de domaine à la place du domaine Vercel.

## 1. Le lien à diffuser

Ton app est déjà utilisable par tout le monde :

```
https://uvsq-project.vercel.app
```

- Au premier lancement, chaque étudiant voit l'écran de bienvenue :
  il entre **son numéro étudiant** (+ ses **identifiants ENT** si l'app les
  demande — l'API l'indique automatiquement). Son EDT s'affiche ensuite.
- Chaque compte ne voit que son propre emploi du temps (testé : numéro
  faux + identifiants valides ➜ rien). Rien n'est stocké sur le serveur.
- On peut ensuite « installer » l'app :
  - **iOS** : Partager ➜ « Sur l'écran d'accueil » (l'app propose un bandeau)
  - **Android** : le navigateur propose l'installation automatiquement
  - **Widget iOS** (prochain cours sur l'écran d'accueil) : voir `widget/README.md`
- L'app a aussi un **onglet Messagerie** : lire et répondre à ses mails Partage, télécharger les pièces jointes (fichiers jusqu'à ~3 Mo, au-delà le webmail UVSQ reste la voie), archiver façon Gmail, supprimer dans la corbeille — chacun n'accède qu'à sa propre boîte avec ses propres identifiants.

## 2. Message prêt à copier dans le groupe de classe

```
📅 Le génie du groupe ? L'EDT du groupe directement sur votre téléphone 👇
https://uvsq-project.vercel.app

Ouvrez le lien ➜ entrez votre numéro étudiant (+ vos identifiants ENT si
demandé). Vos infos restent sur VOTRE téléphone, rien n'est conservé sur
un serveur. Installable comme une vraie app (Sur l'écran d'accueil), et
ça marche même sans réseau (dernier EDT gardé en cache).
Messagerie UVSQ incluse (lire, répondre, archiver, pièces jointes).
Widget iPhone dispo aussi : https://uvsq-project.vercel.app  ➜ voir "Widget" dans les réglages
```

## 3. Le QR code (affiche / tableau / fin d'amphi)

1. Va sur n'importe quel générateur gratuit (ex. `qr.io`, `qrcode-monkey`,
   ouChrome : menu Partager ➜ « Créer un QR code » directement sur la PWA).
2. Colle ton URL ➜ télécharge le PNG ➜ imprime ou projette.
3. À afficher à côté d'un message d'une ligne : « Scanne pour avoir ton EDT ».

Conseil : garde le QR **pointant toujours la même URL** (le domaine final).
Si tu changes de domaine plus tard, l'affiche périmée est la principale
source de confusion.

## 4. Ton propre domaine (remplace uvsq-project.vercel.app)

Le nom de domaine s'achète (les hébergement reste gratuit chez Vercel) :

1. **Achat** (~8–12 €/an) :
   - **OVH** (registrar français, `.fr` facile, interface en français) — recommandé
   - Alternatives : Porkbun, Namecheap, Cloudflare Registrar
2. **Connexion à Vercel** : Dashboard ➜ projet ➜ **Settings ➜ Domains ➜ Add** ➜ ton domaine.
3. **DNS** chez le registrar (Vercel t'affiche exactement quoi mettre) :
   - racine (`ton-edt.fr`) ➜ enregistrement `A` ➜ `76.76.21.21`
   - `www` ➜ `CNAME` ➜ `cname.vercel-dns.com`
   (ou, plus simple : remplacer les nameservers par ceux de Vercel)
4. **HTTPS automatique** : certificat provisioné par Vercel, rien à faire.
5. **Diffusion du domaine partout suite au changement** :
   - le script du widget : constante `APP_URL` en haut de `widget/uvsq-edt-widget.js`
   - les QR codes / éléments déjà diffusés
   - le jour où tu actives le CORS durci : `ALLOWED_ORIGIN=https://ton-edt.fr`
     (fiche complète : `docs/SECURITE-API.md`)
6. Une PWA déjà installée continue de suivre son ancien domaine : il faut
   **réinstaller depuis le nouveau domaine** pour « déménager » proprement.
