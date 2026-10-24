# Durcissement API — fiche projet

> Fiche de prise de notes **pour le jour où un compte UVSQ partagé
> `CELCAT_USERNAME` / `CELCAT_PASSWORD` est configuré dans Vercel en mode
> « secours »** (un seul compte serveur, tous les étudiants passent juste
> leur numéro étudiant). Tout est déjà **codé et testé** : il ne restera
> qu'à ajouter des variables d'environnement dans Vercel.

## Ce qui existe déjà (au 24 oct 2026)

| Protection | Variable | Défaut (sans config) | Effet |
|---|---|---|---|
| CORS restreint | `ALLOWED_ORIGIN` | `*` (historique) | Si définie (ex. `https://ton-edt.vercel.app`) : `Access-Control-Allow-Origin` limité à ce domaine + `Vary: Origin` |
| Rate-limit par IP | `RATE_LIMIT_BURST` | `60` | Rafale max par IP avant HTTP 429 |
| Rate-limit par IP | `RATE_LIMIT_PER_SEC` | `2` | Recharge de jetons par seconde et par IP |

Implémentation : `lib/rate-limit.js` (bucket de jetons, zéro dépendance,
purge auto > 10 000 clés / 30 min). Le limiter est **par instance warm** :
le comptage est approximatif — suffisant contre les floods, pas pour du
comptage global exact (pour ça : Redis externe type Upstash, non branché).

## Procédure le jour J (~5 min dans le dashboard Vercel)

1. **Settings → Environment Variables** du projet :
   - `CELCAT_USERNAME` = le compte ENT « bulletin » (son mot de passe expirera, à maintenir !)
   - `CELCAT_PASSWORD` = son mot de passe
   - `ALLOWED_ORIGIN` = l'URL exacte de la PWA déployée (sans slash final)
   - éventuellement resserer `RATE_LIMIT_BURST` / `RATE_LIMIT_PER_SEC`
     si un grand nombre d'étudiants ne partagent pas ton IP (campus) — sinon laisser les défauts, ils sont volontairement généreux.
2. **Redeploy** pour que les envs s'appliquent.
3. Test rapide depuis un autre réseau :
   ```bash
   curl -sI "https://ton-edt.vercel.app/api/edt" | grep -i "access-control"
   # attendu : Access-Control-Allow-Origin: <ton domaine exact>
   ```
4. Vérifier la 429 : hammer le endpoint (> 60 requêtes rapides depuis la même IP)
   → réponse `{"error":"rate_limited"}` avec header `Retry-After`, message
   affiché proprement dans la PWA.

## Pourquoi ces choix

- **PWA non affectée** : elle appelle `/api/edt` en same-origin, le CORS ne
  s'applique pas à elle.
- **Widget Scriptable non affecté** : Scriptable n'est pas un navigateur,
  le CORS ne s'applique pas (cf. `widget/README.md`).
- **Défauts généreux car le risque est bas** : aujourd'hui, sans compte
  partagé, chaque requête exige des identifiants ENT valides ; le
  rate-limit ne défend qu'un futur où un seul compte ouvrirait des EDT
  pour tout le monde — et évite aussi de faire déclencher un captcha UVSQ
  (trop d'échecs de login = captcha) sur les IP partagées du campus.
- **Un numéro étudiant ≠ une donnée sensible** : l'EDT suit le compte ENT
  authentifié (testé : numéro faux + identifiants valides → rien), donc
  le « rescousse en compte partagé » n'ouvre pas un annuaire de calendars.

## Rappels sécurité déjà appliqués

- Titres/salles/profs CELCAT échappés à l'affichage (`escapeHtml`, fix XSS
  commité `ac8778b`) : la PWA stocke des identifiants dans le localStorage,
  l'injection HTML y serait critique.
- Aucun secret dans le dépôt ; identifiants uniquement en env Vercel ou
  headers de la requête ; aucune base de données ; logs sans credentials.
- L'API ne renvoie plus les noms des devs (champ `student` = numéro).
