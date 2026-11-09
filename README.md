# HORDE — Survie incrémentale

Jeu de survie vu de dessus : les zombies arrivent par vagues, chaque vague plus nombreuse que la précédente. Ils ne vont pas plus vite, c'est le nombre qui fait la différence. Chaque zombie abattu laisse des âmes, qui servent à faire grandir l'arbre de compétences de son personnage entre deux parties.

Il suffit d'ouvrir `index.html` pour jouer. Mis en ligne (par exemple sur GitHub Pages), le jeu peut être ajouté à l'écran d'accueil d'un téléphone et reste jouable hors connexion.

## Les deux personnages

**Le Rōnin** se bat au sabre. Chaque coup de sabre ainsi que chaque pouvoir consomme du Ki, qui se recharge avec le temps :

- **Poussée** (clic droit ou E) : repousse les zombies devant lui ; au rang ultime d'*Onde de choc*, tout autour de lui.
- **Stase temporelle** (F) : une bulle qui ralentit le temps des zombies proches, jusqu'à les figer totalement au rang ultime. Elle se recharge 9 s après la fin de la bulle.
- **Pas du vent** (Espace) : bond invulnérable, qui tranche les zombies traversés dès le niveau 3.
- **Tempête de lames** (R) : tourbillon défensif de lames à échelle humaine autour de lui qui repousse violemment les zombies, détruit les projectiles et réduit les dégâts subis.

**Le Soldat** n'a que son pistolet à munitions illimitées. Le fusil à pompe, le fusil d'assaut, le lance-flammes, le lance-grenades et la mitrailleuse se débloquent dans l'arbre, mais leurs munitions se trouvent dans les **caisses** larguées dans les ruines (il suffit de marcher dessus). Son arbre augmente progressivement les munitions de départ, le contenu et la fréquence des caisses, la capacité du sac, et ajoute grenades, roulade, adrénaline et tourelle.

## Commandes

| Action | Clavier et souris | Tactile |
|---|---|---|
| Se déplacer | ZQSD, WASD ou flèches | Moitié gauche de l'écran |
| Viser / attaquer | Souris, clic gauche maintenu | Automatique, ou glisser sur la moitié droite |
| Poussée / grenade | Clic droit ou E | Bouton |
| Bond / roulade | Espace | Bouton |
| Stase / adrénaline | F | Bouton |
| Tempête / tourelle | R | Bouton |
| Changer d'arme (Soldat) | 1 à 6, molette, Q ou Tab | Bouton 🔄 |
| Pause | Échap ou P | Bouton II |
| Couper le son | M | Options |

Les options proposent aussi une visée et une attaque automatiques à la souris.

## Le jeu

- **Vagues :** coureurs dès la vague 4, Gonflés qui explosent dès la 5, Brutes dès la 7, Cracheurs d'acide dès la 9, et un Colosse toutes les 10 vagues (deux à la vague 20, trois à la 30…).
- **Âmes :** gagnées en ramassant les orbes et à chaque vague terminée. Elles sont gardées même en cas de mort ou d'abandon.
- **Arbres :** environ 30 compétences par personnage, en 5 branches. Maj + clic achète directement, le bouton « Réinitialiser » rend toutes les âmes investies.
- **Départ avancé :** une fois la vague 5, 10, 15… atteinte, on peut recommencer directement depuis cette vague.

La progression est enregistrée dans le navigateur (`localStorage`).

## Fichiers

- `js/data.js` : arbres de compétences, statistiques des personnages et des zombies, composition des vagues.
- `js/game.js` : moteur (simulation, rendu, interface en jeu, commandes).
- `js/sprites.js` : dessins pré-calculés (zombies, sol, obstacles).
- `js/audio.js` : sons synthétisés, aucun fichier audio.
- `js/ui.js` : menus, arbre de compétences, sauvegarde.
- `test-autopilot.js` : pilote automatique utilisé pour mesurer l'équilibrage (non chargé par le jeu).
