# NutriJour

Journal alimentaire en application web installable (PWA) : calories et macros par repas,
objectif calculé (Mifflin-St Jeor), eau, exercices, suivi du poids.

- Ajout rapide de calories, copie d'un repas d'un jour à l'autre, repas enregistrés.
- « Terminer ma journée » : poids estimé dans 5 semaines si chaque jour ressemblait à celui-ci.
- Série de jours de saisie d'affilée.

- HTML / CSS / JavaScript, sans dépendance ni compte.
- Les données restent sur l'appareil (`localStorage`). Export / import JSON dans l'onglet Profil.
- Fonctionne hors ligne (service worker), sauf la recherche par code-barres.

## Données

- Aliments génériques : [table Ciqual 2020](https://ciqual.anses.fr) de l'Anses, Licence Ouverte Etalab
  (`ciqual.json`, extrait : énergie, glucides, protéines, lipides pour 100 g).
- Produits par code-barres : [Open Food Facts](https://world.openfoodfacts.org), licence ODbL.

## Lancer en local

```
python -m http.server 8642
```

puis ouvrir http://localhost:8642.
