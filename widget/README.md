# Widget iOS « Prochain cours » (sans App Store)

Un vrai widget d'écran d'accueil iOS via l'app gratuites [Scriptable](https://scriptable.app).
Résultat : tu cours dans 12 min · titre · salle · nombre de séances du jour, mis à jour toutes les 10 minutes.

## Installation (~3 minutes)

1. Installe **Scriptable** depuis l'App Store (gratuit).
2. Ouvre l'application → bouton **+** pour créer un nouveau script.
3. Copie-colle tout le contenu de **`uvsq-edt-widget.js`**.
4. En haut du script, complète les **4 valeurs** :
   - `APP_URL` : l'URL de la PWA déployée (ex. `https://mon-edt.vercel.app`), **sans** slash final ;
   - `STUDENT_ID` : ton numéro étudiant (fid0, le même que dans la PWA) ;
   - `ENT_LOGIN` / `ENT_PASSWORD` : tes identifiants ENT UVSQ.
5. Lance le script (▶️) une fois pour vérifier — le résultat s'affiche comme aperçu.
6. Sur l'écran d'accueil : appui long → **+** → chercher **Scriptable** → choisir le widget *Medium* → sélectionner le script `uvsq-edt-widget.js`.

C'est tout. Notes :

- **Confidentialité** : les identifiants sont dans ton script, sur ton appareil ; ils transitent chiffrés uniquement vers ton déploiement Vercel puis edt.uvsq.fr, comme dans la PWA (aucune base de données).
- Le compte ENT détermine l'emploi du temps affiché (testé : le `fid0` seul ne suffit pas).
- Si l'EDT devient vide d'un coup → identifiants changed (mot de passe ENT modifié ?), corrige les constantes.
- Android : pas de Scriptable, mais un widget semblable via l'app **KWGT** est possible à terme (même endpoint `?widget=1`).

## Pour les devineurs : ce que le backend fournit

`GET /api/edt?widget=1&id=<fid0>&cid=<cid>` (avec les headers `x-celcat-user` / `x-celcat-pass`)
renvoie la version compacte :

```json
{
  "success": true,
  "now": "2026-10-24T14:02:11.482Z",
  "next": { "start": "...", "end": "...", "title": "ANALYSE", "type": "TD", "room": "B040", "prof": "DUPONT, ALICE" },
  "today": [ { ... } ]
}
```

Ce endpoint ne contient **pas** les `rawDetails` ni la liste entière de l'année (réponse plus courte, plus rapide à charger par le widget).
