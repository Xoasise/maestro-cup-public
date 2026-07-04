# Maestro Cup FC26 — Site public + Panel Admin

Ce pack contient **deux sites indépendants** qui partagent la même base de données Firebase :

- `maestro-public/` → le site que les joueurs consultent (calendrier, poules, phase finale, règlement). À héberger sur un premier dépôt GitHub Pages.
- `maestro-admin/` → ton panel de gestion (scores, pénalités, statut des matchs). À héberger sur un **second** dépôt GitHub Pages, séparé et non partagé avec les joueurs.

Les deux sites lisent/écrivent dans la même base **Firestore**, donc toute mise à jour faite dans le panel admin apparaît en direct sur le site public (grâce à `onSnapshot`, pas besoin de rafraîchir la page).

---

## 1. Créer le projet Firebase

1. Va sur [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet** → donne-lui un nom (ex. `maestro-cup`).
2. Dans le menu de gauche, ouvre **Compilation > Firestore Database** → **Créer une base de données** → choisis le mode **production** (on configurera les règles nous-mêmes juste après) → choisis une région proche de toi.
3. Toujours dans **Compilation > Authentication** → onglet **Sign-in method** → active le fournisseur **E-mail/Mot de passe**.
4. Dans l'onglet **Users** d'Authentication → **Ajouter un utilisateur** → crée ton compte admin (email + mot de passe). C'est ce compte que tu utiliseras pour te connecter au panel admin.
5. Va dans **Paramètres du projet** (icône ⚙️) → section **Vos applications** → clique sur l'icône **`</>`** (Web) → donne un nom à l'app (ex. `maestro-web`) → **Ne coche pas** Firebase Hosting (on utilise GitHub Pages) → copie l'objet `firebaseConfig` affiché.

## 2. Configurer les règles Firestore

Dans **Firestore Database > Règles**, remplace le contenu par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

→ Lecture publique (le site des joueurs n'a pas besoin de compte), écriture réservée aux comptes authentifiés (donc uniquement toi, via le panel admin).

## 3. Renseigner la config Firebase dans les deux sites

Ouvre `maestro-public/firebase-config.js` **et** `maestro-admin/firebase-config.js`, et colle dans les deux fichiers le même objet `firebaseConfig` copié à l'étape 1 (les deux sites doivent pointer vers le même projet).

## 4. Déployer sur GitHub Pages

Pour **chaque** dossier (`maestro-public` et `maestro-admin`), dans deux dépôts GitHub séparés :

```bash
cd maestro-public   # (ou maestro-admin)
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<ton-compte>/<nom-du-repo>.git
git push -u origin main
```

Puis dans **Settings > Pages** du dépôt : Source = `Deploy from a branch`, Branch = `main` / `(root)`. Le site sera disponible à `https://<ton-compte>.github.io/<nom-du-repo>/`.

Répète l'opération pour l'autre dossier dans un second dépôt (ex. `maestro-cup-public` et `maestro-cup-admin`).

⚠️ Ne partage que le lien du site **public** avec les joueurs. Garde le lien du panel **admin** pour toi seul (il n'est protégé que par le login Firebase, donc ne le publie pas largement).

## 5. Initialiser les données du tournoi

1. Ouvre ton panel admin déployé, connecte-toi avec le compte créé à l'étape 1.
2. Va dans l'onglet **Initialisation** → clique sur **Initialiser les données**.
3. Cela crée automatiquement dans Firestore : les 16 équipes (avec leur poule et leur nation) et les 24 matchs de poule (3 journées × 8 matchs), à partir du tirage et du calendrier que tu m'as fournis.

Cette action ne s'exécute qu'une seule fois : si des équipes existent déjà, le bouton ne fait rien (pour ne jamais écraser des scores en cours).

## 6. Utilisation au quotidien

- **Onglet "Matchs en direct"** : bascule rapidement le statut de n'importe quel match (À venir / Live / Terminé), toutes journées confondues — pratique pour indiquer en un clic quel match est en cours.
- **Onglet "Matchs de poule"** : filtre par journée, saisis les scores et passe le match en "Terminé" une fois fini. Les classements de poule (site public) se recalculent automatiquement.
- **Onglet "Pénalités"** : retire des points au classement d'une équipe (ex. abandon volontaire = -1, selon le règlement). La pénalité est visible sur le site public à côté du nom de l'équipe.
- **Onglet "Phase finale"** : dès que les matchs de poule d'un groupe sont terminés, les équipes qualifiées (1ère et 2e de chaque poule) apparaissent automatiquement dans les quarts de finale correspondants. Saisis juste les scores ; les demi-finales et la finale se remplissent ensuite automatiquement avec les vainqueurs.

## Notes / hypothèses

- **Horaires** : le calendrier fourni ne précisait pas d'heure exacte par match, seulement "le 1er match à 19h, le 2e à 19h30…". J'ai donc affecté les créneaux dans l'ordre où les matchs apparaissent dans l'image (Poule A, A, B, B, C, C, D, D), toutes les 30 minutes à partir de 19h, pour les 3 journées. Tu peux ajuster ces horaires directement dans Firestore si besoin (collection `matches`, champ `time`), ou me redemander si tu veux que je les modifie dans le code source.
- **Tirage au sort en cas d'égalité totale** : le règlement prévoit qu'en dernier recours (points, différence de buts, buts marqués et confrontation directe tous identiques) on procède à un tirage au sort. Ce cas étant rarissime avec 2 équipes seulement à égalité complète, il n'est pas automatisé — le site affichera les deux équipes dans un ordre stable mais tu pourras trancher manuellement si ce cas se présente.
- **Forfait sur tapis vert (3-0)** : c'est à toi de saisir ce score comme n'importe quel résultat de match dans le panel admin (retard supérieur à 5 minutes).
