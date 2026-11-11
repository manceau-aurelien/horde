# HORDE — Le labyrinthe

Jeu de survie vu de dessus : un grand labyrinthe, une marée de zombies qui déferle par les couloirs, et deux personnages — le Rōnin et le Soldat — jouables **seul ou à deux à distance**. Chaque zombie abattu laisse des âmes, qui font grandir l'arbre de compétences entre deux parties.

Il suffit d'ouvrir `index.html` pour jouer. Mis en ligne (par exemple sur GitHub Pages), le jeu peut être ajouté à l'écran d'accueil d'un téléphone et reste jouable hors connexion en solo.

## Le labyrinthe et la horde

- **Un labyrinthe différent à chaque partie**, sans cul-de-sac : on peut toujours fuir… ou être pris en tenaille. Quelques places ouvertes servent de champs de bataille.
- **Des centaines de zombies à la fois.** Ils suivent le chemin le plus court vers le joueur le plus proche et s'entassent dans les couloirs : il faut sans cesse choisir sa trajectoire.
- **La carte (Tab)** montre le labyrinthe entier ; le rouge indique où se trouve la horde.
- **La marée monte** : chaque vague a un compte à rebours. Si elle n'est pas nettoyée à temps, la suivante déferle par-dessus.
- **Le labyrinthe se reconfigure** toutes les 3 vagues : des murs se lèvent (rouge), d'autres tombent (bleu).
- **Reliques** (losange violet, flèche à l'écran) : Fureur (dégâts doublés, Ki et munitions gratuits), Nova (souffle la horde) ou Glaciation (fige la horde).
- **Niveaux en cours de partie** : les victimes font monter un niveau partagé (+6 % de dégâts, +3 % de vie, et une onde de choc à chaque palier).
- **Carnage** : enchaîner les victimes sans pause multiplie les âmes, jusqu'à ×2.

## Jouer à deux à distance

1. Les deux joueurs ouvrent le jeu (la même adresse en ligne, ou chacun sa copie).
2. L'un clique sur **Coop en ligne → Créer une partie** et transmet le code de 5 caractères (ou le lien d'invitation).
3. L'autre saisit le code et clique sur **Rejoindre**.
4. L'hôte choisit qui joue le Rōnin et qui joue le Soldat, puis lance.

Chacun garde ses propres âmes et son propre arbre. Les âmes ramassées profitent aux deux joueurs. Un joueur à terre est relevé si son coéquipier reste 3 secondes à côté de lui ; la partie s'arrête quand les deux sont à terre. À deux, la horde est 60 % plus nombreuse et un peu plus résistante.

La liaison est directe entre les deux navigateurs (WebRTC). Le serveur public PeerJS ne sert qu'à les mettre en relation ; il faut donc une connexion Internet, et certains réseaux très restrictifs peuvent bloquer la liaison. La partie continue même si l'un des onglets passe en arrière-plan.

### Réactivité et qualité de connexion

Les positions sont envoyées sur un canal WebRTC non ordonné, sans retransmission : une ancienne position perdue ne retarde plus les suivantes. Les commandes partent à 30 Hz (immédiatement pour un changement de tir ou un pouvoir) et les états du monde à 20 Hz. Le tampon d'envoi des états est limité à 16 Kio ; en cas de congestion, le prochain état remplace celui qui n'a pas pu partir. Les pouvoirs, événements et résultats de fin de partie gardent un canal fiable séparé. Seuls les zombies proches de l'invité sont envoyés ; dans une très grosse horde, ils partent par lots tournants (320 au plus par état, jusqu'à 4 lots) et l'affichage de l'invité attend un peu plus pour les lisser : chaque état reste sous 3 Ko au lieu de dépasser 13 Ko, ce qui évitait de saturer la connexion et de figer la partie.

L'invité lisse les mouvements sur une horloge de rendu avec un délai adaptatif de 75 à 160 ms pour absorber les variations du réseau. En cas de perte, le mouvement n'est extrapolé que pendant 80 ms au maximum. Ses déplacements restent locaux ; ses attaques produisent immédiatement une animation ou un son, tandis que l'hôte continue de décider des impacts, des dégâts et du butin. Le ping aller-retour apparaît au-dessus de la mini-carte ; une absence de messages déclenche l'indication « Connexion instable ».

Après une mise à jour, actualisez **les deux appareils** avant de recréer le salon. Le jeu bloque le démarrage entre versions réseau incompatibles. Ces corrections évitent d'accumuler artificiellement du retard ; elles ne suppriment pas la latence physique de la connexion ni les ralentissements d'un appareil surchargé.

### Vérifier la synchronisation

Avec Node.js installé, exécutez `node --test test-network.js`. Les tests couvrent les deux simulations hôte/invité, le retard, la gigue, les pertes de paquets, les messages désordonnés, la saturation du tampon, les actions fiables, les retours visuels, la fin de partie et le redémarrage.

Pour un essai réel, ouvrez le jeu sur deux appareils, créez une partie, vérifiez le ping, puis testez déplacement, tir, pouvoirs, réanimation et retour au salon. Une partie via deux accès Internet distincts reste nécessaire pour évaluer la qualité de la liaison réelle.

## Les deux personnages

**Le Rōnin** se bat au sabre. Chaque coup de sabre ainsi que chaque pouvoir consomme du Ki, qui se recharge avec le temps :

- **Poussée** (clic droit ou E) : repousse les zombies devant lui ; au rang ultime d'*Onde de choc*, tout autour de lui.
- **Stase temporelle** (F) : une bulle qui ralentit le temps des zombies proches, jusqu'à les figer au rang ultime.
- **Pas du vent** (Espace) : bond invulnérable, qui tranche les zombies traversés dès le niveau 3.
- **Tempête de lames** (R) : tourbillon défensif qui repousse les zombies, détruit les projectiles et réduit les dégâts subis.

**Le Soldat** a un pistolet à munitions illimitées dont les balles traversent plusieurs zombies : dans un couloir, aligner la horde paie. Le fusil à pompe, le fusil d'assaut, le lance-flammes, le lance-grenades et la mitrailleuse se débloquent dans l'arbre ; leurs munitions se trouvent dans les **caisses** dispersées dans le labyrinthe. Grenades (elles passent par-dessus les murs), roulade, adrénaline et tourelle complètent l'arsenal.

La branche **Maniement** (Calibre, Détente rapide, Tir précis, Balles perforantes, Pistolets jumelés) profite à **toutes les armes** : investir dans le pistolet rend aussi les armes ramassées plus fortes. Ramasser une caisse ne change pas l'arme en main. En visée automatique, la caméra ne suit plus l'orientation du tir, et les grenades partent seules vers le plus gros groupe de zombies à portée.

## Commandes

| Action | Clavier et souris | Tactile |
|---|---|---|
| Se déplacer | ZQSD, WASD ou flèches | Moitié gauche de l'écran |
| Viser / attaquer | Souris, clic gauche maintenu | Automatique, ou glisser sur la moitié droite |
| Carte du labyrinthe | Tab | Toucher la mini-carte |
| Poussée / grenade | Clic droit ou E | Bouton |
| Bond / roulade | Espace | Bouton |
| Stase / adrénaline | F | Bouton |
| Tempête / tourelle | R | Bouton |
| Changer d'arme (Soldat) | 1 à 6, molette ou Q | Bouton 🔄 |
| Pause (menu en coop) | Échap ou P | Bouton II |
| Couper le son | M | Options |

## Le bestiaire

Rôdeurs dès le début, meutes de Rampants à la vague 3, Coureurs à la 4, Gonflés explosifs à la 5, Brutes à la 7, Cracheurs à la 9, et un Colosse toutes les 10 vagues. Les murs arrêtent les balles, les crachats et les explosions.

## Fichiers

- `js/data.js` : arbres de compétences, statistiques des personnages et des zombies, composition des vagues.
- `js/world.js` : génération du labyrinthe, collisions, champ de flux (chemin des zombies), reconfiguration.
- `js/engine.js` : état partagé, entrées, effets visuels et sonores répliqués.
- `js/sim.js` : simulation (vagues, joueurs, zombies, projectiles, butin).
- `js/render.js` : rendu du labyrinthe, de la horde et de l'interface en jeu.
- `js/net.js` : liaison pair-à-pair pour le coop.
- `js/game.js` : boucle principale et synchronisation hôte ↔ invité.
- `js/sprites.js`, `js/audio.js`, `js/ui.js` : dessins pré-calculés, sons synthétisés, menus et sauvegarde.
- `test-autopilot.js` : pilote automatique utilisé pour mesurer l'équilibrage (non chargé par le jeu).

**Parties enregistrées :** autant de parties nommées que l'on veut (bouton **📁 Partie** de l'accueil ou du salon coop), par exemple une par coéquipier. Chacune garde ses âmes, ses arbres et ses records ; les réglages suivent le joueur.

La progression est enregistrée dans le navigateur, et protégée par `save-guard.js` :

- le jeu demande au navigateur de ne pas effacer ses données de lui-même (stockage persistant) ;
- un onglet resté ouvert avec une ancienne progression ne peut plus écraser une sauvegarde plus récente : il se recharge à la place ;
- des copies de secours sont gardées, et rendues automatiquement si la sauvegarde est abîmée ;
- dans **Options**, **Exporter un fichier** ou **Copier le code** met la progression de côté, et **Importer** la restaure, y compris sur un autre appareil. L'export contient toutes les parties enregistrées.

Chaque adresse a sa propre sauvegarde : le fichier ouvert par double-clic, le site en ligne et, sur iPhone, l'icône de l'écran d'accueil ne partagent pas la même. Pour passer de l'une à l'autre, exportez puis importez.
